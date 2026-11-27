import asyncio
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base


class MatchPredictionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.host = models.User(username="prediction_host", password_hash="unused")
            self.guest = models.User(username="prediction_guest", password_hash="unused")
            self.predictor = models.User(
                username="prediction_viewer",
                password_hash="unused",
            )
            db.add_all([self.host, self.guest, self.predictor])
            db.commit()
            self.host_id = self.host.id
            self.guest_id = self.guest.id
            self.predictor_id = self.predictor.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _create_opted_in_match(self, db, game_id="chess"):
        host = db.get(models.User, self.host_id)
        guest = db.get(models.User, self.guest_id)
        room = main.create_practice_room(
            main.PracticeRoomCreate(
                game_id=game_id,
                name="Prediction match",
                max_players=2,
                allow_predictions=True,
            ),
            host,
            db,
        )
        joined = asyncio.run(
            main.join_practice_room(room["id"], guest, db, prediction_opt_in=True)
        )
        self.assertFalse(joined["game_started"])
        self.assertTrue(joined["awaiting_host_start"])
        return room["id"]

    def test_unanimous_opt_in_holds_full_room_for_host_start_and_lists_market(self):
        with self.session_factory() as db:
            room_id = self._create_opted_in_match(db)
            room = next(room for room in main.practice_rooms(None, db, None) if room["id"] == room_id)
            feed = main.get_predictions(db.get(models.User, self.predictor_id), db)

        self.assertTrue(room["prediction_ready"])
        self.assertEqual(len(feed["markets"]), 1)
        self.assertEqual(feed["markets"][0]["room_id"], room_id)
        self.assertEqual(
            [player["username"] for player in feed["markets"][0]["players"]],
            ["prediction_host", "prediction_guest"],
        )

    def test_correct_pick_scores_one_point_only_after_authoritative_result(self):
        with self.session_factory() as db:
            room_id = self._create_opted_in_match(db)
            predictor = db.get(models.User, self.predictor_id)
            main.submit_prediction(
                room_id,
                main.PredictionSubmission(predicted_winner_user_id=self.host_id),
                predictor,
                db,
            )
            with self.assertRaises(HTTPException) as player_prediction:
                main.submit_prediction(
                    room_id,
                    main.PredictionSubmission(predicted_winner_user_id=self.host_id),
                    db.get(models.User, self.host_id),
                    db,
                )
            self.assertEqual(player_prediction.exception.status_code, 403)

            asyncio.run(
                main.start_prediction_room(
                    room_id,
                    db.get(models.User, self.host_id),
                    db,
                )
            )
            with self.assertRaises(HTTPException) as closed_prediction:
                main.submit_prediction(
                    room_id,
                    main.PredictionSubmission(predicted_winner_user_id=self.guest_id),
                    predictor,
                    db,
                )
            self.assertEqual(closed_prediction.exception.status_code, 409)
            game = db.scalar(
                select(models.ChessGame).where(models.ChessGame.room_id == room_id)
            )
            game.status = "finished"
            game.state = {
                **game.state,
                "status": "finished",
                "winner_user_id": self.host_id,
            }
            db.commit()

            feed = main.get_predictions(predictor, db)

        self.assertEqual(feed["points"], 1)
        self.assertEqual(feed["recent_predictions"][0]["status"], "correct")
        self.assertEqual(feed["recent_predictions"][0]["points"], 1)
        self.assertEqual(feed["markets"], [])

    def test_tie_prediction_scores_for_a_tied_game_result(self):
        with self.session_factory() as db:
            room_id = self._create_opted_in_match(db, game_id="golf")
            predictor = db.get(models.User, self.predictor_id)
            main.submit_prediction(
                room_id,
                main.PredictionSubmission(predicts_draw=True),
                predictor,
                db,
            )
            asyncio.run(
                main.start_prediction_room(
                    room_id,
                    db.get(models.User, self.host_id),
                    db,
                )
            )
            game = db.scalar(
                select(models.GolfGame).where(models.GolfGame.room_id == room_id)
            )
            game.status = "finished"
            game.state = {
                **game.state,
                "status": "finished",
                "winner_user_ids": [self.host_id, self.guest_id],
            }
            db.commit()
            feed = main.get_predictions(predictor, db)

        self.assertEqual(feed["points"], 1)
        self.assertEqual(feed["recent_predictions"][0]["status"], "correct")

    def test_non_opted_join_keeps_existing_immediate_start_behavior(self):
        with self.session_factory() as db:
            room = main.create_practice_room(
                main.PracticeRoomCreate(
                    game_id="chess",
                    name="No predictions",
                    max_players=2,
                    allow_predictions=True,
                ),
                db.get(models.User, self.host_id),
                db,
            )
            joined = asyncio.run(
                main.join_practice_room(
                    room["id"],
                    db.get(models.User, self.guest_id),
                    db,
                    prediction_opt_in=False,
                )
            )
            game = db.scalar(
                select(models.ChessGame).where(
                    models.ChessGame.room_id == room["id"]
                )
            )

        self.assertTrue(joined["game_started"])
        self.assertFalse(joined["awaiting_host_start"])
        self.assertIsNotNone(game)

    def test_match_players_cannot_be_prediction_participants(self):
        with self.session_factory() as db:
            room_id = self._create_opted_in_match(db)
            with self.assertRaises(HTTPException) as result:
                main.submit_prediction(
                    room_id,
                    main.PredictionSubmission(
                        predicted_winner_user_id=self.guest_id,
                    ),
                    db.get(models.User, self.guest_id),
                    db,
                )

        self.assertEqual(result.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
