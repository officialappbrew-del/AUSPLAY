import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base
from app.security import make_token


class PlayerProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.player = models.User(username="profile_player", password_hash="unused")
            self.opponent = models.User(username="profile_opponent", password_hash="unused")
            self.other_player = models.User(username="profile_other", password_hash="unused")
            self.no_match_player = models.User(
                username="profile_no_match", password_hash="unused"
            )
            db.add_all([
                self.player,
                self.opponent,
                self.other_player,
                self.no_match_player,
            ])
            db.flush()
            self._add_game(
                db,
                "draughts",
                models.DraughtsGame,
                [self.player, self.opponent],
                {
                    "status": "finished",
                    "winner_user_id": self.player.id,
                },
                days_ago=3,
            )
            self._add_game(
                db,
                "golf",
                models.GolfGame,
                [self.player, self.opponent],
                {
                    "status": "finished",
                    "winner_user_ids": [self.player.id, self.opponent.id],
                },
                days_ago=2,
            )
            self._add_game(
                db,
                "chess",
                models.ChessGame,
                [self.player, self.opponent],
                {
                    "status": "finished",
                    "winner_user_id": self.opponent.id,
                },
                days_ago=1,
                white_player_id=self.opponent.id,
                black_player_id=self.player.id,
            )
            self._add_game(
                db,
                "ludo",
                models.LudoGame,
                [self.player, self.opponent],
                {
                    "status": "active",
                    "winner_user_id": None,
                },
                status="active",
                days_ago=0,
            )
            self._add_game(
                db,
                "whot",
                models.WhotGame,
                [self.opponent, self.other_player],
                {
                    "status": "finished",
                    "winner_user_id": self.opponent.id,
                },
                days_ago=4,
            )
            db.add(
                models.SoloDraughtsProgress(
                    user_id=self.player.id,
                    highest_level=4,
                )
            )
            db.commit()
            self.player_id = self.player.id
            self.no_match_player_id = self.no_match_player.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_profile_summarizes_only_viewers_finished_matches(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            profile = main.my_player_profile(player, db)

        self.assertEqual(profile["user"]["username"], "profile_player")
        self.assertNotIn("password_hash", profile["user"])
        self.assertEqual(profile["stats"], {
            "played": 3,
            "wins": 1,
            "draws": 1,
            "losses": 1,
            "win_rate": 33.3,
        })
        self.assertEqual(profile["solo_draughts_highest_level"], 4)
        games = {game["game_id"]: game for game in profile["games"]}
        self.assertEqual(games["draughts"]["wins"], 1)
        self.assertEqual(games["golf"]["draws"], 1)
        self.assertEqual(games["chess"]["losses"], 1)
        self.assertEqual(games["ludo"]["played"], 0)
        self.assertEqual(len(profile["recent_matches"]), 3)
        self.assertEqual(
            [match["game_id"] for match in profile["recent_matches"]],
            ["chess", "golf", "draughts"],
        )
        self.assertEqual(profile["recent_matches"][0]["opponents"], ["profile_opponent"])
        self.assertEqual(
            [match["result"] for match in profile["recent_matches"]],
            ["loss", "draw", "win"],
        )

    def test_profile_without_completed_matches_returns_empty_history_and_zero_stats(self):
        with self.session_factory() as db:
            no_match_player = db.get(models.User, self.no_match_player_id)
            profile = main.my_player_profile(no_match_player, db)

        self.assertEqual(profile["stats"]["played"], 0)
        self.assertEqual(profile["stats"]["win_rate"], 0)
        self.assertEqual(profile["recent_matches"], [])
        self.assertEqual(profile["solo_draughts_highest_level"], 1)

    def test_profile_auth_dependency_rejects_anonymous_and_resolves_token(self):
        with self.session_factory() as db:
            with self.assertRaises(HTTPException) as anonymous:
                main.current_user(None, db)
            authenticated = main.current_user(
                HTTPAuthorizationCredentials(
                    scheme="Bearer",
                    credentials=make_token(self.player_id),
                ),
                db,
            )

        self.assertEqual(anonymous.exception.status_code, 401)
        self.assertEqual(authenticated.id, self.player_id)

    def _add_game(
        self,
        db,
        game_id,
        game_model,
        players,
        state,
        *,
        days_ago,
        status="finished",
        **game_players,
    ):
        room = models.PracticeRoom(
            game_id=game_id,
            name=f"{game_id.title()} room",
            host_user_id=players[0].id,
            max_players=len(players),
        )
        db.add(room)
        db.flush()
        db.add_all(
            models.PracticeRoomSeat(
                room_id=room.id,
                user_id=player.id,
                seat_number=seat_number,
            )
            for seat_number, player in enumerate(players, start=1)
        )
        game_values = {
            "room_id": room.id,
            "state": state,
            "status": status,
            "updated_at": datetime.now(timezone.utc) - timedelta(days=days_ago),
        }
        if game_model is models.DraughtsGame:
            game_values.update(
                red_player_id=game_players.get("red_player_id", players[0].id),
                black_player_id=game_players.get("black_player_id", players[1].id),
            )
        elif game_model is models.ChessGame:
            game_values.update(
                white_player_id=game_players.get("white_player_id", players[0].id),
                black_player_id=game_players.get("black_player_id", players[1].id),
            )
        db.add(game_model(**game_values))


if __name__ == "__main__":
    unittest.main()
