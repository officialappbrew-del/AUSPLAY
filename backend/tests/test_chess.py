import asyncio
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import chess_game, main, models
from app.db import Base


class ChessEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = chess_game.initial_state(white_user_id=1, black_user_id=2)

    def test_initial_position_has_twenty_legal_moves(self):
        self.assertEqual(len(chess_game.legal_moves(self.state, 1)), 20)
        self.assertEqual(chess_game.legal_moves(self.state, 2), [])

    def test_move_updates_turn_and_position(self):
        result = chess_game.apply_move(self.state, 1, "e2e4")
        self.assertEqual(result["turn_user_id"], 2)
        self.assertEqual(result["board"][4][4], "P")
        self.assertEqual(result["moves"], [{"uci": "e2e4", "san": "e4"}])

    def test_illegal_move_and_wrong_player_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "not legal"):
            chess_game.apply_move(self.state, 1, "e2e5")
        with self.assertRaisesRegex(ValueError, "not legal"):
            chess_game.apply_move(self.state, 2, "e7e5")

    def test_pawn_promotion_and_checkmate_are_recorded(self):
        promotion_state = dict(self.state)
        promotion_state["initial_fen"] = "7k/P7/8/8/8/8/8/7K w - - 0 1"
        promoted = chess_game.apply_move(promotion_state, 1, "a7a8q")
        self.assertEqual(promoted["board"][0][0], "Q")

        state = self.state
        for player_id, move in (
            (1, "f2f3"),
            (2, "e7e5"),
            (1, "g2g4"),
            (2, "d8h4"),
        ):
            state = chess_game.apply_move(state, player_id, move)
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["winner_user_id"], 2)

    def test_fivefold_repetition_ends_in_a_draw(self):
        state = self.state
        cycle = (
            (1, "g1f3"),
            (2, "g8f6"),
            (1, "f3g1"),
            (2, "f6g8"),
        )
        for _ in range(4):
            for player_id, move in cycle:
                state = chess_game.apply_move(state, player_id, move)

        self.assertEqual(state["status"], "finished")
        self.assertIsNone(state["winner_user_id"])
        self.assertEqual(state["result"], "1/2-1/2")


class ChessRoomTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.white = models.User(username="white", password_hash="unused")
            self.black = models.User(username="black", password_hash="unused")
            self.outsider = models.User(username="outsider", password_hash="unused")
            db.add_all([self.white, self.black, self.outsider])
            db.commit()
            self.white_id = self.white.id
            self.black_id = self.black.id
            self.outsider_id = self.outsider.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_second_player_starts_game_and_room_move_is_persisted(self):
        with self.session_factory() as db:
            white = db.get(models.User, self.white_id)
            black = db.get(models.User, self.black_id)
            room = main.create_practice_room(
                main.PracticeRoomCreate(game_id="chess", name="Chess room", max_players=2),
                white,
                db,
            )
            result = asyncio.run(main.join_practice_room(room["id"], black, db))
            game = main.get_practice_game(room["id"], white, db)
            listed_room = next(
                item for item in main.practice_rooms(None, db) if item["id"] == room["id"]
            )
            response = asyncio.run(
                main.play_chess_move(
                    room["id"],
                    main.ChessMove(uci="e2e4"),
                    white,
                    db,
                )
            )
            stored_game = db.scalar(
                select(models.ChessGame).where(models.ChessGame.room_id == room["id"])
            )
            events = db.scalars(
                select(models.ChessGameEvent)
                .where(models.ChessGameEvent.game_id == stored_game.id)
                .order_by(models.ChessGameEvent.sequence)
            ).all()

        self.assertTrue(result["game_started"])
        self.assertTrue(next(item for item in main.games() if item["id"] == "chess")["playable"])
        self.assertEqual(game["game_id"], "chess")
        self.assertEqual(game["viewer"]["side"], "white")
        self.assertEqual(listed_room["game_status"], "active")
        self.assertEqual(response["version"], 1)
        self.assertEqual(response["state"]["moves"][-1]["san"], "e4")
        self.assertEqual([event.event_type for event in events], ["game_started", "move"])

    def test_non_player_cannot_submit_chess_move(self):
        with self.session_factory() as db:
            white = db.get(models.User, self.white_id)
            outsider = db.get(models.User, self.outsider_id)
            room = main.create_practice_room(
                main.PracticeRoomCreate(game_id="chess", name="Chess room", max_players=2),
                white,
                db,
            )
            with self.assertRaises(HTTPException) as error:
                asyncio.run(
                    main.play_chess_move(
                        room["id"],
                        main.ChessMove(uci="e2e4"),
                        outsider,
                        db,
                    )
                )

        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
