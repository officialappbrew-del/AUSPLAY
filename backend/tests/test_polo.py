import asyncio
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models, polo
from app.db import Base


class PoloEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = polo.initial_state([1, 2])

    def test_turn_alternates_and_advances_after_both_team_scores(self):
        state = polo.submit_goals(self.state, 1, 2)
        self.assertEqual(state["turn_user_id"], 2)
        self.assertEqual(state["teams"][0]["goals"][0], 2)

        state = polo.submit_goals(state, 2, 1)
        self.assertEqual(state["current_chukka"], 2)
        self.assertEqual(state["turn_user_id"], 1)

    def test_rejects_wrong_turn_and_invalid_goals(self):
        with self.assertRaisesRegex(ValueError, "not your turn"):
            polo.submit_goals(self.state, 2, 1)
        for goals in (-1, 21, True):
            with self.subTest(goals=goals):
                with self.assertRaisesRegex(ValueError, "between 0 and 20"):
                    polo.submit_goals(self.state, 1, goals)

    def test_highest_total_wins_and_tied_match_is_draw(self):
        state = self.state
        for chukka in range(4):
            scores = (3, 1) if chukka == 0 else (2, 1)
            for player_id, score in zip((1, 2), scores):
                state = polo.submit_goals(state, player_id, score)
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["winner_user_ids"], [1])
        self.assertIsNone(state["turn_user_id"])
        with self.assertRaisesRegex(ValueError, "finished"):
            polo.submit_goals(state, 1, 0)

        tied = self.state
        for _ in range(4):
            tied = polo.submit_goals(tied, 1, 2)
            tied = polo.submit_goals(tied, 2, 2)
        self.assertEqual(tied["winner_user_ids"], [1, 2])


class PoloRoomTests(unittest.TestCase):
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
                models.User(username="captain_a", password_hash="unused"),
                models.User(username="captain_b", password_hash="unused"),
                models.User(username="spectator", password_hash="unused"),
            ]
            db.add_all(players)
            db.commit()
            self.player_ids = [player.id for player in players]

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_room_starts_for_two_players_and_persists_chukka_scores(self):
        with self.session_factory() as db:
            captain_a = db.get(models.User, self.player_ids[0])
            room = main.create_practice_room(
                main.PracticeRoomCreate(game_id="polo", name="Polo room", max_players=2),
                captain_a,
                db,
            )
            with self.assertRaises(HTTPException) as not_started:
                main.get_practice_game(room["id"], captain_a, db)

            joined = asyncio.run(
                main.join_practice_room(
                    room["id"],
                    db.get(models.User, self.player_ids[1]),
                    db,
                )
            )
            game = main.get_practice_game(room["id"], captain_a, db)
            response = asyncio.run(
                main.submit_polo_score(
                    room["id"],
                    main.PoloGoalsSubmission(goals=2),
                    captain_a,
                    db,
                )
            )
            listed_room = next(
                item for item in main.practice_rooms(None, db) if item["id"] == room["id"]
            )
            stored = db.scalar(
                select(models.PoloGame).where(models.PoloGame.room_id == room["id"])
            )
            events = db.scalars(
                select(models.PoloGameEvent)
                .where(models.PoloGameEvent.game_id == stored.id)
                .order_by(models.PoloGameEvent.sequence)
            ).all()

        self.assertEqual(not_started.exception.status_code, 409)
        self.assertTrue(joined["game_started"])
        self.assertEqual(game["game_id"], "polo")
        self.assertTrue(game["viewer"]["is_turn"])
        self.assertEqual(response["version"], 1)
        self.assertEqual(response["state"]["teams"][0]["goals"][0], 2)
        self.assertEqual(listed_room["game_status"], "active")
        self.assertEqual(
            [event.event_type for event in events],
            ["game_started", "chukka_score_submitted"],
        )
        catalogue = {item["id"]: item for item in main.games()}
        self.assertEqual(catalogue["polo"]["players"], "2")
        self.assertTrue(catalogue["polo"]["playable"])

    def test_non_player_cannot_submit_polo_score(self):
        with self.session_factory() as db:
            captain_a = db.get(models.User, self.player_ids[0])
            room = models.PracticeRoom(
                game_id="polo",
                name="Polo room",
                host_user_id=captain_a.id,
                max_players=2,
            )
            db.add(room)
            db.flush()
            db.add_all([
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_ids[0], seat_number=1),
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_ids[1], seat_number=2),
            ])
            db.add(
                models.PoloGame(
                    room_id=room.id,
                    state=polo.initial_state(self.player_ids[:2]),
                )
            )
            db.commit()
            outsider = db.get(models.User, self.player_ids[2])
            with self.assertRaises(HTTPException) as error:
                asyncio.run(
                    main.submit_polo_score(
                        room.id,
                        main.PoloGoalsSubmission(goals=0),
                        outsider,
                        db,
                    )
                )

        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
