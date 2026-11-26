import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base
from app.security import hash_password, make_token


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
            self.player = models.User(
                username="profile_player",
                display_name="Profile Player",
                email="private@example.com",
                email_verified_at=datetime.now(timezone.utc),
                password_hash="unused",
            )
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

    def test_public_profile_includes_display_name_but_never_email(self):
        with self.session_factory() as db:
            profile = main.public_player_profile("profile_player", db)
            private_profile = main.my_player_profile(
                db.get(models.User, self.player_id),
                db,
            )

        self.assertEqual(profile["user"]["display_name"], "Profile Player")
        self.assertEqual(profile["user"]["username"], "profile_player")
        self.assertNotIn("email", profile["user"])
        self.assertNotIn("email_verified", profile["user"])
        self.assertEqual(private_profile["user"]["email"], "private@example.com")
        self.assertTrue(private_profile["user"]["email_verified"])

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

    @patch("app.main._send_account_email")
    def test_registration_verifies_email_and_sets_http_only_cookie(self, send_email):
        response = Response()
        with self.session_factory() as db:
            result = main.register(
                main.Credentials(
                    username="cookie_player",
                    password="password-123",
                    age_confirmed=True,
                    display_name="Cookie Player",
                    email="cookie@example.com",
                ),
                response,
                db,
            )
            cookie = response.headers["set-cookie"]
            token = cookie.split(";", 1)[0].split("=", 1)[1]
            authenticated = main.current_user(None, db, token)
            email_body = send_email.call_args.args[2]
            verification_token = email_body.rsplit("verify_email=", 1)[1].strip()
            main.verify_email(
                main.AccountTokenSubmission(token=verification_token),
                db,
            )
            created_user = db.scalar(
                select(models.User).where(models.User.username == "cookie_player")
            )

        self.assertIn("HttpOnly", cookie)
        self.assertIn(main.AUTH_COOKIE_NAME, cookie)
        self.assertEqual(authenticated.username, "cookie_player")
        self.assertEqual(result["token"], token)
        self.assertFalse(result["email_verified"])
        self.assertTrue(result["email_verification_sent"])
        self.assertIsNotNone(created_user.email_verified_at)

    def test_registration_succeeds_without_optional_display_name_or_email(self):
        response = Response()
        with self.session_factory() as db:
            result = main.register(
                main.Credentials(
                    username="optional_profile",
                    password="password-123",
                    age_confirmed=True,
                ),
                response,
                db,
            )
            created_user = db.scalar(
                select(models.User).where(models.User.username == "optional_profile")
            )

        self.assertEqual(result["display_name"], "optional_profile")
        self.assertFalse(result["email_verification_sent"])
        self.assertIsNone(created_user.display_name)
        self.assertIsNone(created_user.email)

    @patch(
        "app.main._send_account_email",
        side_effect=HTTPException(503, "Email delivery is not configured"),
    )
    def test_registration_and_login_succeed_when_email_delivery_fails(self, send_email):
        response = Response()
        with self.session_factory() as db:
            result = main.register(
                main.Credentials(
                    username="smtp_unavailable",
                    password="password-123",
                    age_confirmed=True,
                    email="smtp@example.com",
                ),
                response,
                db,
            )
            login_result = main.login(
                main.Credentials(username="smtp_unavailable", password="password-123"),
                Response(),
                db,
            )

        self.assertFalse(result["email_verification_sent"])
        self.assertEqual(login_result["username"], "smtp_unavailable")
        send_email.assert_called_once()

    def test_login_sets_http_only_cookie(self):
        response = Response()
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            player.password_hash = hash_password("password-123")
            db.commit()

            main.login(
                main.Credentials(username=player.username, password="password-123"),
                response,
                db,
            )
            cookie = response.headers["set-cookie"]
            token = cookie.split(";", 1)[0].split("=", 1)[1]
            authenticated = main.current_user(None, db, token)

        self.assertIn("HttpOnly", cookie)
        self.assertEqual(authenticated.id, self.player_id)

    def test_logout_clears_session_cookie(self):
        response = Response()
        main.logout(response)

        self.assertIn(f"{main.AUTH_COOKIE_NAME}=", response.headers["set-cookie"])
        self.assertIn("Max-Age=0", response.headers["set-cookie"])

    @patch("app.main._send_account_email")
    def test_password_reset_uses_verified_email_and_revokes_old_sessions(self, send_email):
        old_access_token = make_token(self.player_id)
        with self.session_factory() as db:
            response_body = main.request_password_reset(
                main.PasswordResetRequest(email="PRIVATE@example.com"),
                db,
            )
            reset_email = send_email.call_args.args[2]
            reset_token = reset_email.rsplit("reset_password=", 1)[1].strip()
            main.complete_password_reset(
                main.PasswordResetCompletion(
                    token=reset_token,
                    password="new-password-123",
                ),
                Response(),
                db,
            )

            with self.assertRaises(HTTPException) as revoked:
                main.current_user(
                    HTTPAuthorizationCredentials(
                        scheme="Bearer",
                        credentials=old_access_token,
                    ),
                    db,
                )
            with self.assertRaises(HTTPException) as already_used:
                main.complete_password_reset(
                    main.PasswordResetCompletion(
                        token=reset_token,
                        password="another-password-123",
                    ),
                    Response(),
                    db,
                )

        self.assertIn("recovery instructions will be sent", response_body["message"])
        self.assertEqual(revoked.exception.status_code, 401)
        self.assertEqual(already_used.exception.status_code, 400)
        send_email.assert_called_once()

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
