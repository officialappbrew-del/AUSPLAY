import tempfile
import unittest
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main, models
from app.db import Base


class VirtualGameTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.player_a = models.User(username="virtual_player_a", password_hash="unused")
            self.player_b = models.User(username="virtual_player_b", password_hash="unused")
            self.predictor = models.User(username="virtual_predictor", password_hash="unused")
            db.add_all([self.player_a, self.player_b, self.predictor])
            db.flush()
            self.player_a_id = self.player_a.id
            self.player_b_id = self.player_b.id
            self.predictor_id = self.predictor.id
            for user in (self.player_a, self.player_b, self.predictor):
                db.add(models.VirtualCreditWallet(user_id=user.id, balance=1000))
            db.commit()

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _create_completed_chess(self, db, winner, updated_at):
        room = models.PracticeRoom(
            game_id="chess",
            name="Historical match",
            host_user_id=self.player_a_id,
            max_players=2,
        )
        db.add(room)
        db.flush()
        db.add_all([
            models.PracticeRoomSeat(
                room_id=room.id,
                user_id=self.player_a_id,
                seat_number=1,
            ),
            models.PracticeRoomSeat(
                room_id=room.id,
                user_id=self.player_b_id,
                seat_number=2,
            ),
            models.ChessGame(
                room_id=room.id,
                white_player_id=self.player_a_id,
                black_player_id=self.player_b_id,
                state=(
                    {"status": "finished", "winner_user_ids": winner}
                    if isinstance(winner, list)
                    else {"status": "finished", "winner_user_id": winner}
                ),
                status="finished",
                updated_at=updated_at,
            ),
        ])
        db.flush()
        return room.id

    def _seed_two_history_rows(self, db):
        now = models.now()
        self._create_completed_chess(
            db,
            self.player_a_id,
            now - timedelta(days=2),
        )
        self._create_completed_chess(
            db,
            self.player_b_id,
            now - timedelta(days=1),
        )
        db.commit()

    def test_round_uses_completed_match_and_hides_result_and_player_identity(self):
        with self.session_factory() as db:
            self._seed_two_history_rows(db)
            feed = main.get_virtual_games(
                db.get(models.User, self.predictor_id),
                db,
            )

        self.assertEqual(feed["balance"], 1000)
        self.assertEqual(feed["active_round"]["game_id"], "chess")
        self.assertEqual(feed["active_round"]["participant_count"], 2)
        self.assertEqual(feed["active_round"]["sample_size"], 1)
        self.assertEqual(
            [option["label"] for option in feed["active_round"]["options"]],
            ["Player A", "Player B", "Draw / tie"],
        )
        self.assertNotIn("outcome_key", feed["active_round"])
        self.assertNotIn("virtual_player_a", str(feed))
        self.assertNotIn("virtual_player_b", str(feed))
        self.assertEqual(
            {option["key"]: option["odds_milli"] for option in feed["active_round"]["options"]},
            {"player_1": 4000, "player_2": 2000, "draw": 4000},
        )

    def test_correct_stake_settles_once_and_never_touches_money_ledger(self):
        with self.session_factory() as db:
            self._seed_two_history_rows(db)
            predictor = db.get(models.User, self.predictor_id)
            round_data = main.get_virtual_games(predictor, db)["active_round"]
            placed = main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_1", stake=100),
                predictor,
                db,
            )
            self.assertEqual(placed["balance"], 900)
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()

            first_settlement = main.get_virtual_games(predictor, db)
            balance_after_first_settlement = first_settlement["balance"]
            second_settlement = main.get_virtual_games(predictor, db)
            bet = db.scalar(
                select(models.VirtualBet).where(
                    models.VirtualBet.round_id == round_data["id"],
                    models.VirtualBet.user_id == self.predictor_id,
                )
            )
            money_entries = db.scalars(select(models.LedgerEntry)).all()

        self.assertEqual(balance_after_first_settlement, 1300)
        self.assertEqual(second_settlement["balance"], 1300)
        self.assertEqual(bet.payout, 400)
        self.assertEqual(first_settlement["recent_bets"][0]["status"], "won")
        self.assertEqual(money_entries, [])

    def test_replacing_a_bet_refunds_prior_stake_before_new_stake(self):
        with self.session_factory() as db:
            self._seed_two_history_rows(db)
            predictor = db.get(models.User, self.predictor_id)
            round_data = main.get_virtual_games(predictor, db)["active_round"]
            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_1", stake=300),
                predictor,
                db,
            )
            replaced = main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_2", stake=200),
                predictor,
                db,
            )
            transaction_types = db.scalars(
                select(models.VirtualCreditTransaction.entry_type)
                .where(models.VirtualCreditTransaction.user_id == self.predictor_id)
                .order_by(models.VirtualCreditTransaction.id)
            ).all()

        self.assertEqual(replaced["balance"], 800)
        self.assertEqual(transaction_types, ["stake", "stake_refund", "stake"])

    def test_insufficient_credit_stake_is_rejected_without_debit(self):
        with self.session_factory() as db:
            self._seed_two_history_rows(db)
            predictor = db.get(models.User, self.predictor_id)
            round_data = main.get_virtual_games(predictor, db)["active_round"]
            with self.assertRaises(HTTPException) as result:
                main.place_virtual_bet(
                    round_data["id"],
                    main.VirtualBetSubmission(outcome_key="player_1", stake=1001),
                    predictor,
                    db,
                )
            wallet = db.get(models.VirtualCreditWallet, self.predictor_id)

        self.assertEqual(result.exception.status_code, 422)
        self.assertEqual(wallet.balance, 1000)

    def test_expired_round_closes_betting_and_reveals_historical_result(self):
        with self.session_factory() as db:
            self._seed_two_history_rows(db)
            predictor = db.get(models.User, self.predictor_id)
            round_data = main.get_virtual_games(predictor, db)["active_round"]
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()

            with self.assertRaises(HTTPException) as result:
                main.place_virtual_bet(
                    round_data["id"],
                    main.VirtualBetSubmission(outcome_key="player_1", stake=50),
                    predictor,
                    db,
                )
            revealed = main.get_virtual_games(predictor, db)

        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(revealed["recent_rounds"][0]["result"], "Player A")
        self.assertEqual(revealed["balance"], 1000)

    def test_tied_historical_result_is_revealed_as_a_draw(self):
        with self.session_factory() as db:
            self._create_completed_chess(
                db,
                [self.player_a_id, self.player_b_id],
                models.now() - timedelta(days=1),
            )
            db.commit()
            predictor = db.get(models.User, self.predictor_id)
            round_data = main.get_virtual_games(predictor, db)["active_round"]
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()

            revealed = main.get_virtual_games(predictor, db)

        self.assertEqual(revealed["recent_rounds"][0]["result"], "Draw / tie")

    def test_no_completed_history_does_not_create_a_fake_round(self):
        with self.session_factory() as db:
            feed = main.get_virtual_games(db.get(models.User, self.predictor_id), db)
            rounds = db.scalars(select(models.VirtualRound)).all()

        self.assertIsNone(feed["active_round"])
        self.assertEqual(rounds, [])


if __name__ == "__main__":
    unittest.main()
