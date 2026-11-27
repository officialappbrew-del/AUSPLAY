"""add NGN wallets, match stakes, and historical virtual rounds

Revision ID: e4d1b72c903a
Revises: f317a6c85b29
Create Date: 2026-11-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4d1b72c903a"
down_revision: Union[str, Sequence[str], None] = "f317a6c85b29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "practice_rooms",
        sa.Column("stake_kobo", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "practice_match_settlements",
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("total_pot_kobo", sa.Integer(), nullable=False),
        sa.Column("commission_kobo", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="settled", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["practice_rooms.id"]),
        sa.PrimaryKeyConstraint("room_id"),
    )
    op.create_table(
        "admin_wallet_topups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("amount_kobo", sa.Integer(), nullable=False),
        sa.Column("reference", sa.String(length=80), nullable=False),
        sa.Column("reason", sa.String(length=240), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount_kobo > 0", name="ck_admin_wallet_topup_amount"),
        sa.ForeignKeyConstraint(["admin_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference"),
    )
    op.create_index("ix_admin_wallet_topups_user_id", "admin_wallet_topups", ["user_id"])
    op.create_table(
        "wallet_withdrawals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount_kobo", sa.Integer(), nullable=False),
        sa.Column("bank_code", sa.String(length=16), nullable=False),
        sa.Column("recipient_code", sa.String(length=80), nullable=False),
        sa.Column("reference", sa.String(length=80), nullable=False),
        sa.Column("transfer_code", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="processing", nullable=False),
        sa.Column("status_detail", sa.String(length=240), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("amount_kobo > 0", name="ck_wallet_withdrawal_amount"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference"),
    )
    op.create_index("ix_wallet_withdrawals_user_id", "wallet_withdrawals", ["user_id"])
    op.create_index("ix_wallet_withdrawals_status", "wallet_withdrawals", ["status"])
    op.create_table(
        "virtual_rounds",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.String(length=24), nullable=False),
        sa.Column("source_game_id", sa.Integer(), nullable=True),
        sa.Column("source_room_id", sa.Integer(), nullable=True),
        sa.Column("participant_count", sa.Integer(), nullable=False),
        sa.Column("outcome_key", sa.String(length=16), nullable=False),
        sa.Column("odds", sa.JSON(), nullable=False),
        sa.Column("sample_size", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("commission_kobo", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "participant_count >= 2",
            name="ck_virtual_round_participant_count",
        ),
        sa.ForeignKeyConstraint(["source_room_id"], ["practice_rooms.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_virtual_rounds_game_id", "virtual_rounds", ["game_id"])
    op.create_index("ix_virtual_rounds_status", "virtual_rounds", ["status"])
    op.create_index(
        "uq_virtual_rounds_single_open",
        "virtual_rounds",
        ["status"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
        sqlite_where=sa.text("status = 'open'"),
    )
    op.create_table(
        "virtual_bets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("outcome_key", sa.String(length=16), nullable=False),
        sa.Column("stake_kobo", sa.Integer(), nullable=False),
        sa.Column("payout_kobo", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("stake_kobo > 0", name="ck_virtual_bet_stake"),
        sa.ForeignKeyConstraint(["round_id"], ["virtual_rounds.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("round_id", "user_id"),
    )
    op.create_index("ix_virtual_bets_round_id", "virtual_bets", ["round_id"])
    op.create_index("ix_virtual_bets_user_id", "virtual_bets", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_virtual_bets_user_id", table_name="virtual_bets")
    op.drop_index("ix_virtual_bets_round_id", table_name="virtual_bets")
    op.drop_table("virtual_bets")
    op.drop_index("uq_virtual_rounds_single_open", table_name="virtual_rounds")
    op.drop_index("ix_virtual_rounds_status", table_name="virtual_rounds")
    op.drop_index("ix_virtual_rounds_game_id", table_name="virtual_rounds")
    op.drop_table("virtual_rounds")
    op.drop_index("ix_wallet_withdrawals_status", table_name="wallet_withdrawals")
    op.drop_index("ix_wallet_withdrawals_user_id", table_name="wallet_withdrawals")
    op.drop_table("wallet_withdrawals")
    op.drop_index("ix_admin_wallet_topups_user_id", table_name="admin_wallet_topups")
    op.drop_table("admin_wallet_topups")
    op.drop_table("practice_match_settlements")
    op.drop_column("practice_rooms", "stake_kobo")
