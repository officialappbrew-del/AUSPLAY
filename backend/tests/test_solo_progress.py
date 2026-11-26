import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base


class SoloDraughtsProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            user = models.User(username="player", password_hash="unused")
            db.add(user)
            db.commit()
            self.user_id = user.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_winning_unlocks_the_next_level_and_is_idempotent(self):
        with self.session_factory() as db:
            user = db.get(models.User, self.user_id)
            initial = main.get_solo_draughts_progress(user, db)
            first_win = main.complete_solo_draughts_level(
                main.SoloDraughtsLevelCompletion(level=1),
                user,
                db,
            )
            duplicate_win = main.complete_solo_draughts_level(
                main.SoloDraughtsLevelCompletion(level=1),
                user,
                db,
            )
            current = main.get_solo_draughts_progress(user, db)

        self.assertEqual(initial["highest_level"], 1)
        self.assertEqual(first_win["highest_level"], 2)
        self.assertEqual(duplicate_win["highest_level"], 2)
        self.assertEqual(current["highest_level"], 2)

    def test_cannot_complete_a_level_that_is_still_locked(self):
        with self.session_factory() as db:
            user = db.get(models.User, self.user_id)
            with self.assertRaises(HTTPException) as error:
                main.complete_solo_draughts_level(
                    main.SoloDraughtsLevelCompletion(level=2),
                    user,
                    db,
                )

        self.assertEqual(error.exception.status_code, 409)

    def test_level_100_is_the_maximum(self):
        with self.session_factory() as db:
            db.add(models.SoloDraughtsProgress(user_id=self.user_id, highest_level=100))
            db.commit()
            user = db.get(models.User, self.user_id)
            result = main.complete_solo_draughts_level(
                main.SoloDraughtsLevelCompletion(level=100),
                user,
                db,
            )

        self.assertEqual(result["highest_level"], 100)


if __name__ == "__main__":
    unittest.main()
