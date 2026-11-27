"""add historical virtual game rounds and credits

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
    op.create_table(
        "virtual_rounds",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.String(length=24), nullable=False),
        sa.Column("source_game_id", sa.Integer(), nullable=False),
        sa.Column("source_room_id", sa.Integer(), nullable=False),
        sa.Column("participant_count", sa.Integer(), nullable=False),
        sa.Column("outcome_key", sa.String(length=16), nullable=False),
        sa.Column("odds", sa.JSON(), nullable=False),
        sa.Column("sample_size", sa.Integer(), server_default="0", nullable=False),
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
        sa.UniqueConstraint("game_id", "source_game_id"),
    )
    op.create_index(
        "ix_virtual_rounds_game_id",
        "virtual_rounds",
        ["game_id"],
        unique=False,
    )
    op.create_index(
        "ix_virtual_rounds_status",
        "virtual_rounds",
        ["status"],
        unique=False,
    )
    op.create_index(
        "uq_virtual_rounds_single_open",
        "virtual_rounds",
        ["status"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
        sqlite_where=sa.text("status = 'open'"),
    )
    op.create_table(
        "virtual_credit_wallets",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("balance", sa.Integer(), server_default="1000", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("balance >= 0", name="ck_virtual_credit_wallet_balance"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "virtual_bets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("outcome_key", sa.String(length=16), nullable=False),
        sa.Column("stake", sa.Integer(), nullable=False),
        sa.Column("odds_milli", sa.Integer(), nullable=False),
        sa.Column("payout", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("stake > 0", name="ck_virtual_bet_stake"),
        sa.CheckConstraint("odds_milli >= 1000", name="ck_virtual_bet_odds"),
        sa.ForeignKeyConstraint(["round_id"], ["virtual_rounds.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("round_id", "user_id"),
    )
    op.create_index("ix_virtual_bets_round_id", "virtual_bets", ["round_id"], unique=False)
    op.create_index("ix_virtual_bets_user_id", "virtual_bets", ["user_id"], unique=False)
    op.create_table(
        "virtual_credit_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("entry_type", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["round_id"], ["virtual_rounds.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_virtual_credit_transactions_round_id",
        "virtual_credit_transactions",
        ["round_id"],
        unique=False,
    )
    op.create_index(
        "ix_virtual_credit_transactions_user_id",
        "virtual_credit_transactions",
        ["user_id"],
        unique=False,
    )

    op.execute(
        "INSERT INTO virtual_credit_wallets (user_id, balance, created_at, updated_at) "
        "SELECT id, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM users"
    )
    op.execute(
        "INSERT INTO virtual_credit_transactions "
        "(user_id, round_id, amount, entry_type, created_at) "
        "SELECT id, NULL, 1000, 'initial_grant', CURRENT_TIMESTAMP FROM users"
    )


def downgrade() -> None:
    op.drop_index(
        "ix_virtual_credit_transactions_user_id",
        table_name="virtual_credit_transactions",
    )
    op.drop_index(
        "ix_virtual_credit_transactions_round_id",
        table_name="virtual_credit_transactions",
    )
    op.drop_table("virtual_credit_transactions")
    op.drop_index("ix_virtual_bets_user_id", table_name="virtual_bets")
    op.drop_index("ix_virtual_bets_round_id", table_name="virtual_bets")
    op.drop_table("virtual_bets")
    op.drop_table("virtual_credit_wallets")
    op.drop_index("uq_virtual_rounds_single_open", table_name="virtual_rounds")
    op.drop_index("ix_virtual_rounds_status", table_name="virtual_rounds")
    op.drop_index("ix_virtual_rounds_game_id", table_name="virtual_rounds")
    op.drop_table("virtual_rounds")
