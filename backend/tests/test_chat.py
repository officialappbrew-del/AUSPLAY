import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base


class PracticeRoomChatTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            host = models.User(username="host", password_hash="unused")
            guest = models.User(username="guest", password_hash="unused")
            outsider = models.User(username="outsider", password_hash="unused")
            db.add_all([host, guest, outsider])
            db.flush()
            room = models.PracticeRoom(
                game_id="draughts",
                name="Chat room",
                host_user_id=host.id,
                max_players=2,
            )
            db.add(room)
            db.flush()
            db.add_all([
                models.PracticeRoomSeat(room_id=room.id, user_id=host.id, seat_number=1),
                models.PracticeRoomSeat(room_id=room.id, user_id=guest.id, seat_number=2),
            ])
            db.commit()
            self.room_id = room.id
            self.host_id = host.id
            self.guest_id = guest.id
            self.outsider_id = outsider.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_room_players_can_share_persisted_messages(self):
        with self.session_factory() as db:
            host = db.get(models.User, self.host_id)
            guest = db.get(models.User, self.guest_id)
            sent = main.send_practice_room_chat(
                self.room_id,
                main.PracticeRoomMessageRequest(content="  Good luck!  "),
                host,
                db,
            )
            history = main.get_practice_room_chat(self.room_id, guest, db)

        self.assertEqual(sent["content"], "Good luck!")
        self.assertEqual(
            history["messages"],
            [{
                "id": sent["id"],
                "username": "host",
                "content": "Good luck!",
                "created_at": sent["created_at"],
            }],
        )

    def test_non_player_cannot_read_or_send_room_chat(self):
        with self.session_factory() as db:
            outsider = db.get(models.User, self.outsider_id)
            with self.assertRaises(HTTPException) as read_error:
                main.get_practice_room_chat(self.room_id, outsider, db)
            with self.assertRaises(HTTPException) as send_error:
                main.send_practice_room_chat(
                    self.room_id,
                    main.PracticeRoomMessageRequest(content="Hello"),
                    outsider,
                    db,
                )

        self.assertEqual(read_error.exception.status_code, 403)
        self.assertEqual(send_error.exception.status_code, 403)

    def test_blank_messages_are_rejected(self):
        with self.session_factory() as db:
            host = db.get(models.User, self.host_id)
            with self.assertRaises(HTTPException) as error:
                main.send_practice_room_chat(
                    self.room_id,
                    main.PracticeRoomMessageRequest(content="   "),
                    host,
                    db,
                )

        self.assertEqual(error.exception.status_code, 422)
        with self.session_factory() as db:
            self.assertIsNone(db.scalar(select(models.PracticeRoomMessage.id)))


if __name__ == "__main__":
    unittest.main()
