import asyncio
import hashlib
import hmac
import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app import main, models
from app.db import Base


class VirtualGameTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            self.player_a = models.User(username="virtual_player_a", password_hash="unused")
            self.player_b = models.User(username="virtual_player_b", password_hash="unused")
            self.predictor = models.User(username="virtual_predictor", password_hash="unused")
            self.admin = models.User(
                username="virtual_admin",
                password_hash="unused",
                role="admin",
            )
            db.add_all([self.player_a, self.player_b, self.predictor, self.admin])
            db.flush()
            self.player_a_id = self.player_a.id
            self.player_b_id = self.player_b.id
            self.predictor_id = self.predictor.id
            self.admin_id = self.admin.id
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def _fund(self, db, user_id, amount_kobo):
        db.add(models.LedgerEntry(
            user_id=user_id,
            account="available",
            amount=amount_kobo,
            ref=f"test-funding:{user_id}:{amount_kobo}",
        ))
        db.flush()

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
                state={
                    "status": "finished",
                    "winner_user_ids": winner if isinstance(winner, list) else (
                        [winner] if winner is not None else []
                    ),
                },
                status="finished",
                updated_at=updated_at,
            ),
        ])
        db.flush()
        return room.id

    def _seed_completed_chess(self, db, count=10, winner=None):
        winner = self.player_a_id if winner is None else winner
        now = models.now()
        for index in range(count):
            self._create_completed_chess(
                db,
                winner,
                now - timedelta(days=count - index),
            )
        db.commit()

    def _open_round(self, db, user_id=None):
        player = db.get(models.User, user_id or self.predictor_id)
        return main.get_virtual_games(player, db)["active_round"]

    def test_accounts_start_with_zero_balance_and_demo_round_rejects_stakes(self):
        with self.session_factory() as db:
            feed = main.get_virtual_games(db.get(models.User, self.predictor_id), db)
            round_data = feed["active_round"]
            balance = main._wallet_balance(db, self.predictor_id)
            demo_pick = main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(
                    outcome_key="player_1",
                    stake_kobo=0,
                ),
                db.get(models.User, self.predictor_id),
                db,
            )
            with self.assertRaises(HTTPException) as result:
                main.place_virtual_bet(
                    round_data["id"],
                    main.VirtualBetSubmission(
                        outcome_key="player_1",
                        stake_kobo=100,
                    ),
                    db.get(models.User, self.predictor_id),
                    db,
                )

        self.assertEqual(balance, 0)
        self.assertTrue(round_data["is_demo"])
        self.assertTrue(demo_pick["demo"])
        self.assertEqual(result.exception.status_code, 409)

    def test_demo_pick_settles_without_touching_wallet(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.predictor_id)
            feed = main.get_virtual_games(player, db)
            round_data = feed["active_round"]
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            main.place_virtual_bet(
                virtual_round.id,
                main.VirtualBetSubmission(
                    outcome_key=virtual_round.outcome_key,
                    stake_kobo=0,
                ),
                player,
                db,
            )
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()
            settled_feed = main.get_virtual_games(player, db)
            bet = db.scalar(
                select(models.VirtualBet).where(
                    models.VirtualBet.round_id == virtual_round.id,
                    models.VirtualBet.user_id == self.predictor_id,
                )
            )
            wallet_balance = main._wallet_balance(db, self.predictor_id)
            locked_balance = main._wallet_balance(db, self.predictor_id, "locked")
            ledger_count = db.scalar(
                select(func.count(models.LedgerEntry.id)).where(
                    models.LedgerEntry.user_id == self.predictor_id,
                )
            )

        self.assertEqual(bet.payout_kobo, 0)
        self.assertEqual(settled_feed["recent_bets"][0]["status"], "demo_correct")
        self.assertEqual(wallet_balance, 0)
        self.assertEqual(locked_balance, 0)
        self.assertEqual(ledger_count or 0, 0)

    def test_no_history_opens_demo_rounds_for_all_supported_games(self):
        with self.session_factory() as db:
            feed = main.get_virtual_games(db.get(models.User, self.predictor_id), db)

        self.assertEqual(len(feed["active_rounds"]), len(main.VIRTUAL_GAME_LABELS))
        self.assertEqual(
            {round_data["game_id"] for round_data in feed["active_rounds"]},
            set(main.VIRTUAL_GAME_LABELS),
        )
        self.assertTrue(all(round_data["is_demo"] for round_data in feed["active_rounds"]))

    def test_public_catalogue_lists_games_and_actual_history_counts(self):
        with self.session_factory() as db:
            self._seed_completed_chess(db, count=3)
            catalogue = main.get_virtual_games_catalogue(db)["games"]

        self.assertEqual(len(catalogue), len(main.VIRTUAL_GAME_LABELS))
        chess = next(game for game in catalogue if game["game_id"] == "chess")
        self.assertEqual(chess["completed_matches"], 3)
        self.assertEqual(chess["eligible_player_counts"], [])
        self.assertTrue(chess["demo_only"])
        self.assertTrue(all("outcome" not in game for game in catalogue))

    def test_paystack_deposit_initialization_uses_server_config_and_ngn(self):
        body = main.WalletDepositRequest(
            amount_kobo=25000,
            request_key="funding-request-123456",
            email="player@example.com",
        )
        reference = f"ausplay-deposit-{body.request_key}"
        with self.session_factory() as db, patch.dict(
            os.environ,
            {
                "PAYSTACK_SECRET_KEY": "test-paystack-secret",
                "FRONTEND_URL": "https://ausplay.example",
            },
        ), patch(
            "app.main._paystack_request",
            return_value={
                "reference": reference,
                "authorization_url": "https://checkout.paystack.com/test",
            },
        ) as paystack_request:
            result = main.initialize_wallet_deposit(
                body,
                db.get(models.User, self.predictor_id),
                db,
            )
            deposit = db.scalar(
                select(models.WalletDeposit).where(
                    models.WalletDeposit.reference == reference,
                )
            )

        payload = paystack_request.call_args.args[2]
        self.assertEqual(result["authorization_url"], "https://checkout.paystack.com/test")
        self.assertEqual(deposit.status, "pending")
        self.assertEqual(payload["amount"], body.amount_kobo)
        self.assertEqual(payload["currency"], "NGN")
        self.assertEqual(payload["callback_url"], (
            f"https://ausplay.example/?payment=wallet&reference={reference}#predictions"
        ))

    def test_paystack_deposit_verification_credits_once_and_checks_amount(self):
        reference = "ausplay-deposit-verify-request"
        with self.session_factory() as db:
            db.add(models.WalletDeposit(
                user_id=self.predictor_id,
                amount_kobo=20000,
                reference=reference,
                status="pending",
            ))
            db.commit()
            player = db.get(models.User, self.predictor_id)
            mismatch = {"reference": reference, "status": "success", "amount": 19999, "currency": "NGN"}
            with patch("app.main._paystack_request", return_value=mismatch):
                with self.assertRaises(HTTPException) as result:
                    main.verify_wallet_deposit(reference, player, db)
            self.assertEqual(result.exception.status_code, 409)
            self.assertEqual(main._wallet_balance(db, self.predictor_id), 0)

            valid = {"reference": reference, "status": "success", "amount": 20000, "currency": "NGN"}
            with patch("app.main._paystack_request", return_value=valid) as paystack_request:
                first = main.verify_wallet_deposit(reference, player, db)
                second = main.verify_wallet_deposit(reference, player, db)
            credit_count = db.scalar(
                select(func.count(models.LedgerEntry.id)).where(
                    models.LedgerEntry.ref == f"deposit:{reference}:credit",
                )
            )
            balance = main._wallet_balance(db, self.predictor_id)

        self.assertEqual(first["status"], "success")
        self.assertEqual(second["status"], "success")
        self.assertEqual(paystack_request.call_count, 1)
        self.assertEqual(credit_count, 1)
        self.assertEqual(balance, 20000)

    def test_signed_paystack_deposit_webhook_is_idempotent(self):
        reference = "ausplay-deposit-webhook-request"
        secret = "test-paystack-secret"
        with self.session_factory() as db:
            db.add(models.WalletDeposit(
                user_id=self.predictor_id,
                amount_kobo=15000,
                reference=reference,
                status="pending",
            ))
            db.commit()
            payload = json.dumps({
                "event": "charge.success",
                "data": {
                    "reference": reference,
                    "status": "success",
                    "amount": 15000,
                    "currency": "NGN",
                },
            }).encode()
            signature = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()

            async def receive():
                return {"type": "http.request", "body": payload, "more_body": False}

            request = Request(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/payments/paystack/webhook",
                    "headers": [(b"x-paystack-signature", signature.encode())],
                },
                receive,
            )
            with patch.dict(os.environ, {"PAYSTACK_SECRET_KEY": secret}):
                asyncio.run(main.paystack_webhook(request, db))
                asyncio.run(main.paystack_webhook(request, db))
            balance = main._wallet_balance(db, self.predictor_id)
            credit_count = db.scalar(
                select(func.count(models.LedgerEntry.id)).where(
                    models.LedgerEntry.ref == f"deposit:{reference}:credit",
                )
            )

        self.assertEqual(balance, 15000)
        self.assertEqual(credit_count, 1)

    def test_requires_ten_completed_matches_for_real_money_round(self):
        with self.session_factory() as db:
            self._seed_completed_chess(db, count=9)
            round_data = self._open_round(db)

        self.assertTrue(round_data["is_demo"])
        self.assertEqual(round_data["sample_size"], 0)

    def test_real_history_replaces_demos_and_recycles_without_creating_more(self):
        with self.session_factory() as db:
            demo_round = self._open_round(db)
            self.assertTrue(demo_round["is_demo"])
            self._seed_completed_chess(db, count=10)

            round_data = self._open_round(db)
            self.assertFalse(round_data["is_demo"])
            for _ in range(11):
                current = db.get(models.VirtualRound, round_data["id"])
                current.closes_at = models.now() - timedelta(seconds=1)
                db.commit()
                round_data = self._open_round(db)
                self.assertFalse(round_data["is_demo"])

            chess_demo_count = db.scalar(
                select(func.count(models.VirtualRound.id)).where(
                    models.VirtualRound.is_demo.is_(True),
                    models.VirtualRound.game_id == "chess",
                )
            )
            other_demo_count = db.scalar(
                select(func.count(models.VirtualRound.id)).where(
                    models.VirtualRound.is_demo.is_(True),
                    models.VirtualRound.game_id != "chess",
                )
            )
            real_rounds = db.scalars(
                select(models.VirtualRound).where(models.VirtualRound.is_demo.is_(False))
            ).all()

        self.assertEqual(chess_demo_count or 0, 0)
        self.assertEqual(other_demo_count, 6)
        self.assertGreater(len(real_rounds), 10)

    def test_pooled_prediction_pays_winner_and_records_ten_percent_commission_once(self):
        with self.session_factory() as db:
            self._fund(db, self.predictor_id, 50000)
            self._fund(db, self.player_b_id, 50000)
            self._seed_completed_chess(db, count=10)
            round_data = self._open_round(db)
            self.assertFalse(round_data["is_demo"])
            self.assertEqual(round_data["sample_size"], 9)

            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_1", stake_kobo=10000),
                db.get(models.User, self.predictor_id),
                db,
            )
            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_2", stake_kobo=20000),
                db.get(models.User, self.player_b_id),
                db,
            )
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()

            feed = main.get_virtual_games(db.get(models.User, self.predictor_id), db)
            bet = db.scalar(
                select(models.VirtualBet).where(
                    models.VirtualBet.round_id == round_data["id"],
                    models.VirtualBet.user_id == self.predictor_id,
                )
            )
            locked_balance = main._wallet_balance(db, self.predictor_id, "locked")
            winner_balance = main._wallet_balance(db, self.predictor_id)
            loser_balance = main._wallet_balance(db, self.player_b_id)

            main._settle_virtual_round(db, virtual_round)
            db.commit()
            winner_balance_after_repeat = main._wallet_balance(db, self.predictor_id)
            commission_kobo = virtual_round.commission_kobo
            payout_kobo = bet.payout_kobo

        self.assertEqual(commission_kobo, 2000)
        self.assertEqual(payout_kobo, 28000)
        self.assertEqual(locked_balance, 0)
        self.assertEqual(winner_balance, 68000)
        self.assertEqual(loser_balance, 30000)
        self.assertEqual(winner_balance_after_repeat, winner_balance)
        self.assertEqual(feed["recent_bets"][0]["status"], "won")

    def test_no_winning_pool_refunds_stakes_without_commission(self):
        with self.session_factory() as db:
            self._fund(db, self.predictor_id, 50000)
            self._seed_completed_chess(db)
            round_data = self._open_round(db)
            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_2", stake_kobo=10000),
                db.get(models.User, self.predictor_id),
                db,
            )
            virtual_round = db.get(models.VirtualRound, round_data["id"])
            virtual_round.closes_at = models.now() - timedelta(seconds=1)
            db.commit()
            main.get_virtual_games(db.get(models.User, self.predictor_id), db)
            balance = main._wallet_balance(db, self.predictor_id)

        self.assertEqual(virtual_round.commission_kobo, 0)
        self.assertEqual(balance, 50000)

    def test_replacing_prediction_releases_old_stake_and_locks_new_stake(self):
        with self.session_factory() as db:
            self._fund(db, self.predictor_id, 50000)
            self._seed_completed_chess(db)
            round_data = self._open_round(db)
            player = db.get(models.User, self.predictor_id)
            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_1", stake_kobo=30000),
                player,
                db,
            )
            main.place_virtual_bet(
                round_data["id"],
                main.VirtualBetSubmission(outcome_key="player_2", stake_kobo=20000),
                player,
                db,
            )
            available = main._wallet_balance(db, self.predictor_id)
            locked = main._wallet_balance(db, self.predictor_id, "locked")

        self.assertEqual(available, 30000)
        self.assertEqual(locked, 20000)

    def test_room_stake_escrow_and_settlement_apply_commission(self):
        with self.session_factory() as db:
            self._fund(db, self.player_a_id, 50000)
            self._fund(db, self.player_b_id, 50000)
            room = models.PracticeRoom(
                game_id="chess",
                name="Staked practice",
                host_user_id=self.player_a_id,
                max_players=2,
                stake_kobo=10000,
            )
            db.add(room)
            db.flush()
            db.add_all([
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_a_id, seat_number=1),
                models.PracticeRoomSeat(room_id=room.id, user_id=self.player_b_id, seat_number=2),
            ])
            db.flush()
            main._escrow_practice_room_stakes(db, room)
            db.commit()
            main._settle_practice_match(
                db,
                room.id,
                {"status": "finished", "winner_user_id": self.player_a_id},
            )
            db.commit()
            settlement = db.get(models.PracticeMatchSettlement, room.id)
            winner_balance = main._wallet_balance(db, self.player_a_id)
            loser_balance = main._wallet_balance(db, self.player_b_id)
            locked = main._wallet_balance(db, self.player_a_id, "locked")

        self.assertEqual(settlement.total_pot_kobo, 20000)
        self.assertEqual(settlement.commission_kobo, 1000)
        self.assertEqual(winner_balance, 59000)
        self.assertEqual(loser_balance, 40000)
        self.assertEqual(locked, 0)

    def test_admin_topup_is_audited_and_uses_kobo(self):
        with self.session_factory() as db:
            result = main.admin_wallet_topup(
                main.AdminWalletTopUpRequest(
                    username="virtual_predictor",
                    amount_kobo=12500,
                    reference="verified-fund-123",
                    reason="Verified cash transfer receipt",
                ),
                db.get(models.User, self.admin_id),
                db,
            )
            entries = db.scalars(
                select(models.LedgerEntry).where(
                    models.LedgerEntry.user_id == self.predictor_id
                )
            ).all()

        self.assertEqual(result["available_kobo"], 12500)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].amount, 12500)

    def test_paystack_withdrawal_otp_and_reversal_webhook_are_idempotent(self):
        with self.session_factory() as db:
            self._fund(db, self.predictor_id, 50000)
            with patch(
                "app.main._paystack_request",
                side_effect=[
                    {"recipient_code": "RCP_test"},
                    {"status": "otp", "transfer_code": "TRF_test"},
                ],
            ):
                withdrawal = main.request_wallet_withdrawal(
                    main.WalletWithdrawalRequest(
                        amount_kobo=10000,
                        request_key="1234567890abcdef",
                        account_name="Virtual Player",
                        account_number="0123456789",
                        bank_code="001",
                    ),
                    db.get(models.User, self.predictor_id),
                    db,
                )
            row = db.scalar(
                select(models.WalletWithdrawal).where(
                    models.WalletWithdrawal.reference == withdrawal["reference"]
                )
            )
            self.assertEqual(main._wallet_balance(db, self.predictor_id), 40000)
            self.assertEqual(main._wallet_balance(db, self.predictor_id, "locked"), 10000)
            with patch(
                "app.main._paystack_request",
                return_value={"status": "success"},
            ):
                main.finalize_paystack_withdrawal(
                    row.id,
                    main.PaystackTransferOTP(otp="123456"),
                    db.get(models.User, self.admin_id),
                    db,
                )
            self.assertEqual(row.status, "success")

            payload = json.dumps({
                "event": "transfer.reversed",
                "data": {"reference": row.reference},
            }).encode()
            secret = "test-paystack-secret"
            signature = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()

            async def receive():
                return {"type": "http.request", "body": payload, "more_body": False}

            request = Request(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/payments/paystack/webhook",
                    "headers": [(b"x-paystack-signature", signature.encode())],
                },
                receive,
            )
            with patch.dict(os.environ, {"PAYSTACK_SECRET_KEY": secret}):
                asyncio.run(main.paystack_webhook(request, db))
                asyncio.run(main.paystack_webhook(request, db))
            balance_after_reversals = main._wallet_balance(db, self.predictor_id)
            withdrawal_status = row.status

        self.assertEqual(withdrawal_status, "reversed")
        self.assertEqual(balance_after_reversals, 50000)


if __name__ == "__main__":
    unittest.main()
