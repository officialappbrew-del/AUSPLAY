import asyncio
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models, snooker
from app.db import Base


class SnookerEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = snooker.initial_state([1, 2])

    def test_turn_alternates_and_high_break_wins_frame(self):
        state = snooker.submit_frame_score(self.state, 1, 72)
        self.assertEqual(state["turn_user_id"], 2)
        self.assertEqual(state["players"][0]["scores"][0], 72)

        state = snooker.submit_frame_score(state, 2, 45)
        self.assertEqual(state["players"][0]["frame_wins"], 1)
        self.assertEqual(state["current_frame"], 2)
        self.assertEqual(state["turn_user_id"], 1)

    def test_best_of_three_finishes_as_soon_as_a_player_wins_two_frames(self):
        state = self.state
        for _ in range(2):
            state = snooker.submit_frame_score(state, 1, 80)
            state = snooker.submit_frame_score(state, 2, 40)

        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["winner_user_ids"], [1])
        self.assertEqual(state["players"][0]["frame_wins"], 2)
        self.assertEqual(state["current_frame"], 2)
        self.assertIsNone(state["turn_user_id"])
        with self.assertRaisesRegex(ValueError, "finished"):
            snooker.submit_frame_score(state, 1, 0)

    def test_frame_tie_is_not_awarded_and_match_tie_is_supported(self):
        state = snooker.submit_frame_score(self.state, 1, 55)
        state = snooker.submit_frame_score(state, 2, 55)
        self.assertEqual([player["frame_wins"] for player in state["players"]], [0, 0])
        self.assertEqual(state["current_frame"], 2)

        state = snooker.submit_frame_score(state, 1, 60)
        state = snooker.submit_frame_score(state, 2, 60)
        state = snooker.submit_frame_score(state, 1, 48)
        state = snooker.submit_frame_score(state, 2, 48)
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["winner_user_ids"], [1, 2])

    def test_rejects_out_of_turn_and_out_of_range_scores(self):
        with self.assertRaisesRegex(ValueError, "not your turn"):
            snooker.submit_frame_score(self.state, 2, 1)
        for break_points in (-1, 156, True):
            with self.subTest(break_points=break_points):
                with self.assertRaisesRegex(ValueError, "between 0 and 155"):
                    snooker.submit_frame_score(self.state, 1, break_points)


class SnookerRoomTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            players = [
                models.User(username="snooker_a", password_hash="unused"),
                models.User(username="snooker_b", password_hash="unused"),
                models.User(username="snooker_spectator", password_hash="unused"),
            ]
            db.add_all(players)
            db.commit()
            self.player_ids = [player.id for player in players]

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_room_starts_for_two_players_and_persists_frame_score(self):
        with self.session_factory() as db:
            player_a = db.get(models.User, self.player_ids[0])
            room = main.create_practice_room(
                main.PracticeRoomCreate(
                    game_id="snooker",
                    name="Snooker room",
                    max_players=2,
                ),
                player_a,
                db,
            )
            with self.assertRaises(HTTPException) as not_started:
                main.get_practice_game(room["id"], player_a, db)

            join_result = asyncio.run(
                main.join_practice_room(
                    room["id"],
                    db.get(models.User, self.player_ids[1]),
                    db,
                )
            )
            game = main.get_practice_game(room["id"], player_a, db)
            response = asyncio.run(
                main.submit_snooker_frame_score(
                    room["id"],
                    main.SnookerFrameScoreSubmission(break_points=63),
                    player_a,
                    db,
                )
            )
            room_summary = next(
                item for item in main.practice_rooms(None, db) if item["id"] == room["id"]
            )
            stored = db.scalar(
                select(models.SnookerGame).where(models.SnookerGame.room_id == room["id"])
            )
            events = db.scalars(
                select(models.SnookerGameEvent)
                .where(models.SnookerGameEvent.game_id == stored.id)
                .order_by(models.SnookerGameEvent.sequence)
            ).all()

        self.assertEqual(not_started.exception.status_code, 409)
        self.assertTrue(join_result["game_started"])
        self.assertEqual(game["game_id"], "snooker")
        self.assertTrue(game["viewer"]["is_turn"])
        self.assertEqual(response["version"], 1)
        self.assertEqual(response["state"]["players"][0]["scores"][0], 63)
        self.assertEqual(room_summary["game_status"], "active")
        self.assertEqual(
            [event.event_type for event in events],
            ["game_started", "frame_score_submitted"],
        )
        catalogue = {item["id"]: item for item in main.games()}
        self.assertEqual(catalogue["snooker"]["players"], "2")
        self.assertTrue(catalogue["snooker"]["playable"])

    def test_non_player_cannot_submit_frame_score(self):
        with self.session_factory() as db:
            player_a = db.get(models.User, self.player_ids[0])
            room = models.PracticeRoom(
                game_id="snooker",
                name="Snooker room",
                host_user_id=player_a.id,
                max_players=2,
            )
            db.add(room)
            db.flush()
            db.add_all([
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_ids[0], seat_number=1),
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_ids[1], seat_number=2),
            ])
            db.add(
                models.SnookerGame(
                    room_id=room.id,
                    state=snooker.initial_state(self.player_ids[:2]),
                )
            )
            db.commit()
            outsider = db.get(models.User, self.player_ids[2])
            with self.assertRaises(HTTPException) as error:
                asyncio.run(
                    main.submit_snooker_frame_score(
                        room.id,
                        main.SnookerFrameScoreSubmission(break_points=10),
                        outsider,
                        db,
                    )
                )

        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
