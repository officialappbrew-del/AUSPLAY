import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models, solo_games, whot
class SoloGamesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        models.User.__table__.create(self.engine)
        models.SoloGameProgress.__table__.create(self.engine)
        models.SoloGameSession.__table__.create(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            user = models.User(username="solo-player", password_hash="unused")
            other_user = models.User(username="other-player", password_hash="unused")
            db.add_all([user, other_user])
            db.commit()
            self.user_id = user.id
            self.other_user_id = other_user.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _user(self, db, user_id=None):
        return db.get(models.User, user_id or self.user_id)

    def _start(self, db, game_id, level=1, user_id=None):
        user = self._user(db, user_id)
        return main.start_solo_game(
            game_id,
            main.SoloGameStart(level=level),
            user,
            db,
        )

    def _action(self, db, game_id, solo_session, action, user_id=None):
        user = self._user(db, user_id)
        return main.play_solo_game_action(
            game_id,
            solo_session["solo_session_id"],
            main.SoloGameAction(**action),
            user,
            db,
        )

    def test_all_six_games_create_persisted_sessions(self):
        with self.session_factory() as db:
            for game_id in solo_games.GAME_NAMES:
                result = self._start(db, game_id)
                self.assertEqual(result["session"]["game_id"], game_id)
                self.assertEqual(result["session"]["status"], "active")

                current = main.get_current_solo_game(
                    game_id,
                    self._user(db),
                    db,
                )
                self.assertEqual(
                    current["session"]["solo_session_id"],
                    result["session"]["solo_session_id"],
                )

    def test_chess_computer_replies_and_state_is_persisted(self):
        with self.session_factory() as db:
            started = self._start(db, "chess")
            result = self._action(
                db,
                "chess",
                started["session"],
                {"action": "move", "uci": "e2e4"},
            )

        self.assertEqual(len(result["session"]["state"]["moves"]), 2)
        self.assertTrue(result["session"]["viewer"]["is_turn"])
        self.assertGreater(len(result["session"]["legal_moves"]), 0)

    def test_ludo_and_whot_computer_actions_preserve_public_game_state(self):
        with self.session_factory() as db:
            ludo_started = self._start(db, "ludo")
            with patch("app.solo_games.randbelow", return_value=0):
                ludo_result = self._action(
                    db,
                    "ludo",
                    ludo_started["session"],
                    {"action": "roll"},
                )

            whot_started = self._start(db, "whot")
            whot_state = db.get(
                models.SoloGameSession,
                whot_started["session"]["solo_session_id"],
            ).state
            user_moves = whot.legal_moves(whot_state, self.user_id)
            if user_moves:
                card_id = user_moves[0]
                card = next(
                    card for card in whot_state["players"][0]["hand"]
                    if card["id"] == card_id
                )
                action = {
                    "action": "play_card",
                    "card_id": card_id,
                    "chosen_suit": "circle" if card["number"] == 20 else None,
                }
            else:
                action = {"action": "draw"}
            whot_result = self._action(db, "whot", whot_started["session"], action)

        self.assertTrue(ludo_result["session"]["viewer"]["is_turn"])
        self.assertEqual(ludo_result["session"]["state"]["status"], "active")
        computer = next(
            player
            for player in whot_result["session"]["state"]["players"]
            if player["user_id"] != self.user_id
        )
        self.assertEqual(computer["hand"], [])
        self.assertGreater(computer["card_count"], 0)

    def test_scorecards_generate_opponent_scores_and_unlock_only_their_game(self):
        with self.session_factory() as db:
            golf_started = self._start(db, "golf")
            golf_result = self._action(
                db,
                "golf",
                golf_started["session"],
                {"action": "score", "value": 4},
            )
            golf_computer = next(
                player
                for player in golf_result["session"]["state"]["players"]
                if player["user_id"] != self.user_id
            )

            polo_started = self._start(db, "polo")
            polo_result = self._action(
                db,
                "polo",
                polo_started["session"],
                {"action": "score", "value": 20},
            )
            polo_computer = next(
                team
                for team in polo_result["session"]["state"]["teams"]
                if team["user_id"] != self.user_id
            )

            snooker_started = self._start(db, "snooker")
            snooker_result = self._action(
                db,
                "snooker",
                snooker_started["session"],
                {"action": "score", "value": 155},
            )
            snooker_computer = next(
                player
                for player in snooker_result["session"]["state"]["players"]
                if player["user_id"] != self.user_id
            )

        self.assertIsInstance(golf_computer["scores"][0], int)
        self.assertIsInstance(polo_computer["goals"][0], int)
        self.assertIsInstance(snooker_computer["scores"][0], int)

    def test_winning_unlocks_next_level_only_for_that_game(self):
        with self.session_factory() as db:
            started = self._start(db, "polo")
            session = started["session"]
            result = None
            for _ in range(4):
                result = self._action(
                    db,
                    "polo",
                    session,
                    {"action": "score", "value": 20},
                )
                session = result["session"]

            self.assertEqual(session["status"], "finished")
            self.assertEqual(result["progress"]["highest_level"], 2)
            self.assertEqual(
                main.get_solo_game_progress("golf", self._user(db), db)["highest_level"],
                1,
            )
            self._start(db, "polo", level=2)
            with self.assertRaises(HTTPException) as error:
                self._start(db, "polo", level=3)

        self.assertEqual(error.exception.status_code, 409)

    def test_solo_sessions_are_private_to_their_owner(self):
        with self.session_factory() as db:
            started = self._start(db, "chess")
            with self.assertRaises(HTTPException) as error:
                self._action(
                    db,
                    "chess",
                    started["session"],
                    {"action": "move", "uci": "e2e4"},
                    user_id=self.other_user_id,
                )
            persisted = db.scalar(
                select(models.SoloGameSession).where(
                    models.SoloGameSession.id
                    == started["session"]["solo_session_id"]
                )
            )

        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(persisted.user_id, self.user_id)

    def test_scorecard_opponents_scale_with_level(self):
        with patch("app.solo_games.randbelow", return_value=2):
            low_golf = solo_games._computer_golf_score(4, 1)
            high_golf = solo_games._computer_golf_score(4, 100)
            low_polo = solo_games._computer_polo_goals(1)
            high_polo = solo_games._computer_polo_goals(100)
            low_snooker = solo_games._computer_snooker_break(1)
            high_snooker = solo_games._computer_snooker_break(100)

        self.assertGreater(low_golf, high_golf)
        self.assertLess(low_polo, high_polo)
        self.assertLess(low_snooker, high_snooker)


if __name__ == "__main__":
    unittest.main()
