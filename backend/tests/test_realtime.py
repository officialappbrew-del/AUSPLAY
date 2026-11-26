import asyncio
import json
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app import draughts, main, models, security
from app.db import Base
from app.realtime import RoomUpdateManager
from app.security import make_token


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class BrokenWebSocket:
    def __init__(self):
        self.attempts = 0
        self.messages = []

    async def send_json(self, message):
        self.attempts += 1
        self.messages.append(message)
        raise RuntimeError("socket is closed")


class FakeConnection:
    def __init__(self, token):
        self.token = token
        self.messages = []
        self.close_code = None
        self.received_auth = False

    async def accept(self):
        pass

    async def receive_text(self):
        if not self.received_auth:
            self.received_auth = True
            return json.dumps({"token": self.token})
        raise WebSocketDisconnect()

    async def send_json(self, message):
        self.messages.append(message)

    async def close(self, code):
        self.close_code = code


class RoomUpdateManagerTests(unittest.TestCase):
    def test_publishes_only_version_signal_to_same_room(self):
        manager = RoomUpdateManager()
        room_socket = FakeWebSocket()
        other_socket = FakeWebSocket()
        manager.connect(7, room_socket)
        manager.connect(8, other_socket)

        asyncio.run(manager.publish(7, 3))

        self.assertEqual(
            room_socket.messages,
            [{"type": "game_updated", "room_id": 7, "version": 3}],
        )
        self.assertEqual(other_socket.messages, [])

    def test_disconnect_removes_empty_room_connections(self):
        manager = RoomUpdateManager()
        room_socket = FakeWebSocket()
        manager.connect(7, room_socket)

        manager.disconnect(7, room_socket)
        asyncio.run(manager.publish(7, 1))

        self.assertEqual(room_socket.messages, [])

    def test_publish_removes_failed_connections(self):
        manager = RoomUpdateManager()
        room_socket = BrokenWebSocket()
        manager.connect(7, room_socket)

        asyncio.run(manager.publish(7, 1))
        asyncio.run(manager.publish(7, 2))

        self.assertEqual(room_socket.attempts, 1)
        self.assertEqual(
            room_socket.messages,
            [{"type": "game_updated", "room_id": 7, "version": 1}],
        )


class RoomWebSocketTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        self.session_patch = patch.object(main, "SessionLocal", self.session_factory)
        self.session_patch.start()
        self.key_patch = patch.object(
            security,
            "SECRET_KEY",
            "test-only-signing-key-with-at-least-thirty-two-bytes",
        )
        self.key_patch.start()

        with self.session_factory() as db:
            host = models.User(username="host", password_hash="unused")
            guest = models.User(username="guest", password_hash="unused")
            spectator = models.User(username="spectator", password_hash="unused")
            db.add_all([host, guest, spectator])
            db.flush()
            room = models.PracticeRoom(
                game_id="draughts",
                name="Test room",
                host_user_id=host.id,
                max_players=2,
            )
            db.add(room)
            db.flush()
            db.add(
                models.PracticeRoomSeat(
                    room_id=room.id,
                    user_id=host.id,
                    seat_number=1,
                )
            )
            db.add(
                models.DraughtsGame(
                    room_id=room.id,
                    red_player_id=host.id,
                    black_player_id=guest.id,
                    state=draughts.initial_state(host.id, guest.id),
                )
            )
            waiting_room = models.PracticeRoom(
                game_id="draughts",
                name="Waiting room",
                host_user_id=host.id,
                max_players=2,
            )
            db.add(waiting_room)
            db.flush()
            db.add(
                models.PracticeRoomSeat(
                    room_id=waiting_room.id,
                    user_id=host.id,
                    seat_number=1,
                )
            )
            db.commit()
            self.room_id = room.id
            self.waiting_room_id = waiting_room.id
            self.host_token = make_token(host.id)
            self.spectator_token = make_token(spectator.id)

    def tearDown(self):
        self.key_patch.stop()
        self.session_patch.stop()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_seated_player_receives_initial_version(self):
        connection = FakeConnection(self.host_token)

        asyncio.run(main.room_game_updates(connection, self.room_id))

        self.assertEqual(
            connection.messages,
            [{"type": "connected", "version": 0}],
        )
        self.assertIsNone(connection.close_code)

    def test_seated_player_can_subscribe_before_game_starts(self):
        connection = FakeConnection(self.host_token)

        asyncio.run(main.room_game_updates(connection, self.waiting_room_id))

        self.assertEqual(
            connection.messages,
            [{"type": "connected", "version": None}],
        )
        self.assertIsNone(connection.close_code)

    def test_second_player_join_publishes_game_start(self):
        connection = FakeWebSocket()
        main.room_updates.connect(self.waiting_room_id, connection)
        try:
            with self.session_factory() as db:
                guest = db.scalar(select(models.User).where(models.User.username == "guest"))
                result = asyncio.run(
                    main.join_practice_room(self.waiting_room_id, guest, db)
                )
        finally:
            main.room_updates.disconnect(self.waiting_room_id, connection)

        self.assertTrue(result["game_started"])
        self.assertEqual(
            connection.messages,
            [{"type": "game_updated", "room_id": self.waiting_room_id, "version": 0}],
        )

    def test_draughts_move_publishes_new_version_only(self):
        connection = FakeWebSocket()
        main.room_updates.connect(self.room_id, connection)
        try:
            with self.session_factory() as db:
                host = db.scalar(select(models.User).where(models.User.username == "host"))
                game = db.scalar(
                    select(models.DraughtsGame).where(
                        models.DraughtsGame.room_id == self.room_id
                    )
                )
                move = draughts.legal_moves(game.state, host.id)[0]
                response = asyncio.run(
                    main.play_draughts_move(
                        self.room_id,
                        main.DraughtsMove(
                            from_x=move["from_x"],
                            from_y=move["from_y"],
                            to_x=move["to_x"],
                            to_y=move["to_y"],
                        ),
                        host,
                        db,
                    )
                )
        finally:
            main.room_updates.disconnect(self.room_id, connection)

        self.assertEqual(response["version"], 1)
        self.assertEqual(
            connection.messages,
            [{"type": "game_updated", "room_id": self.room_id, "version": 1}],
        )

    def test_non_seated_user_is_rejected(self):
        connection = FakeConnection(self.spectator_token)

        asyncio.run(main.room_game_updates(connection, self.room_id))

        self.assertEqual(connection.close_code, 4403)
        self.assertEqual(connection.messages, [])


if __name__ == "__main__":
    unittest.main()
