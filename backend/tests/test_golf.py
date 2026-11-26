import asyncio
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import golf, main, models
from app.db import Base


class GolfEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = golf.initial_state([1, 2, 3])

    def test_turn_moves_between_players_then_advances_hole(self):
        state = golf.submit_score(self.state, 1, 4)
        self.assertEqual(state["turn_user_id"], 2)
        self.assertEqual(state["players"][0]["scores"][0], 4)

        state = golf.submit_score(state, 2, 5)
        self.assertEqual(state["turn_user_id"], 3)
        state = golf.submit_score(state, 3, 3)
        self.assertEqual(state["current_hole"], 2)
        self.assertEqual(state["turn_user_id"], 1)

    def test_rejects_scores_out_of_turn_or_out_of_range(self):
        with self.assertRaisesRegex(ValueError, "not your turn"):
            golf.submit_score(self.state, 2, 4)
        with self.assertRaisesRegex(ValueError, "between 1 and 15"):
            golf.submit_score(self.state, 1, 16)
        with self.assertRaisesRegex(ValueError, "between 1 and 15"):
            golf.submit_score(self.state, 1, 0)

    def test_lowest_total_wins_after_nine_holes(self):
        state = self.state
        for hole in range(9):
            scores = (3, 4, 5) if hole == 0 else (4, 4, 4)
            for player_id, score in zip((1, 2, 3), scores):
                state = golf.submit_score(state, player_id, score)

        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["winner_user_ids"], [1])
        self.assertIsNone(state["turn_user_id"])
        with self.assertRaisesRegex(ValueError, "finished"):
            golf.submit_score(state, 1, 4)

    def test_equal_totals_are_reported_as_a_tie(self):
        state = self.state
        for _ in range(9):
            for player_id in (1, 2, 3):
                state = golf.submit_score(state, player_id, 4)

        self.assertEqual(state["winner_user_ids"], [1, 2, 3])


class GolfRoomTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.players = [
                models.User(username=f"golfer{index}", password_hash="unused")
                for index in range(1, 4)
            ]
            db.add_all(self.players)
            db.commit()
            self.player_ids = [player.id for player in self.players]

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_golf_room_starts_when_full_and_scores_are_saved(self):
        with self.session_factory() as db:
            host = db.get(models.User, self.player_ids[0])
            room = main.create_practice_room(
                main.PracticeRoomCreate(game_id="golf", name="Golf room", max_players=2),
                host,
                db,
            )
            with self.assertRaises(HTTPException) as not_started:
                main.get_practice_game(room["id"], host, db)
            join_result = asyncio.run(
                main.join_practice_room(
                    room["id"],
                    db.get(models.User, self.player_ids[1]),
                    db,
                )
            )
            game = main.get_practice_game(room["id"], host, db)
            response = asyncio.run(
                main.submit_golf_score(
                    room["id"],
                    main.GolfScoreSubmission(strokes=3),
                    host,
                    db,
                )
            )
            listed_room = next(
                item for item in main.practice_rooms(None, db) if item["id"] == room["id"]
            )
            stored = db.scalar(
                select(models.GolfGame).where(models.GolfGame.room_id == room["id"])
            )
            events = db.scalars(
                select(models.GolfGameEvent)
                .where(models.GolfGameEvent.game_id == stored.id)
                .order_by(models.GolfGameEvent.sequence)
            ).all()

        self.assertTrue(join_result["game_started"])
        self.assertEqual(not_started.exception.status_code, 409)
        self.assertEqual(game["game_id"], "golf")
        self.assertTrue(game["viewer"]["is_turn"])
        self.assertEqual(response["version"], 1)
        self.assertEqual(response["state"]["players"][0]["scores"][0], 3)
        self.assertEqual(listed_room["game_status"], "active")
        self.assertEqual([event.event_type for event in events], ["game_started", "hole_score_submitted"])
        self.assertTrue(next(item for item in main.games() if item["id"] == "golf")["playable"])

    def test_non_player_cannot_submit_a_score(self):
        with self.session_factory() as db:
            host = db.get(models.User, self.player_ids[0])
            db.add(
                models.PracticeRoom(
                    game_id="golf",
                    name="Golf room",
                    host_user_id=host.id,
                    max_players=2,
                )
            )
            db.flush()
            room = db.scalar(select(models.PracticeRoom))
            db.add(models.PracticeRoomSeat(room_id=room.id, user_id=host.id, seat_number=1))
            db.add(models.PracticeRoomSeat(
                room_id=room.id,
                user_id=self.player_ids[1],
                seat_number=2,
            ))
            db.add(models.GolfGame(room_id=room.id, state=golf.initial_state(self.player_ids[:2])))
            db.commit()
            outsider = db.get(models.User, self.player_ids[2])
            with self.assertRaises(HTTPException) as error:
                asyncio.run(
                    main.submit_golf_score(
                        room.id,
                        main.GolfScoreSubmission(strokes=4),
                        outsider,
                        db,
                    )
                )

        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
