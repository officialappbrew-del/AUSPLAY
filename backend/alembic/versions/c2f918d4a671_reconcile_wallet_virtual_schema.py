"""reconcile wallet and virtual-game schema drift

Revision ID: c2f918d4a671
Revises: f5100d8c33e1
Create Date: 2026-11-28 18:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2f918d4a671"
down_revision: Union[str, Sequence[str], None] = "f5100d8c33e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _ensure_column(table_name: str, column: sa.Column) -> None:
    if _inspector().has_table(table_name):
        columns = {item["name"] for item in _inspector().get_columns(table_name)}
        if column.name not in columns:
            op.add_column(table_name, column)


def _ensure_table(table_name: str, *columns_and_constraints) -> None:
    if not _inspector().has_table(table_name):
        op.create_table(table_name, *columns_and_constraints)


def _ensure_index(
    index_name: str,
    table_name: str,
    columns: list[str],
    unique: bool = False,
) -> None:
    indexes = {item["name"] for item in _inspector().get_indexes(table_name)}
    if index_name not in indexes:
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    _ensure_column(
        "practice_rooms",
        sa.Column("stake_kobo", sa.Integer(), server_default="0", nullable=False),
    )
    _ensure_column(
        "virtual_rounds",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    _ensure_column(
        "virtual_rounds",
        sa.Column("commission_kobo", sa.Integer(), server_default="0", nullable=False),
    )
    _ensure_column(
        "virtual_bets",
        sa.Column("stake_kobo", sa.Integer(), server_default="0", nullable=False),
    )
    _ensure_column(
        "virtual_bets",
        sa.Column("payout_kobo", sa.Integer(), nullable=True),
    )

    check_constraints = {
        item["name"] for item in _inspector().get_check_constraints("virtual_bets")
    }
    if "ck_virtual_bet_stake" not in check_constraints:
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("virtual_bets") as batch_op:
                batch_op.create_check_constraint(
                    "ck_virtual_bet_stake",
                    "stake_kobo >= 0",
                )
        else:
            op.create_check_constraint(
                "ck_virtual_bet_stake",
                "virtual_bets",
                "stake_kobo >= 0",
            )

    _ensure_table(
        "practice_match_settlements",
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("total_pot_kobo", sa.Integer(), nullable=False),
        sa.Column("commission_kobo", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="settled", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["practice_rooms.id"]),
        sa.PrimaryKeyConstraint("room_id"),
    )
    _ensure_table(
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
    _ensure_table(
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

    _ensure_index("ix_admin_wallet_topups_user_id", "admin_wallet_topups", ["user_id"])
    _ensure_index("ix_wallet_withdrawals_user_id", "wallet_withdrawals", ["user_id"])
    _ensure_index("ix_wallet_withdrawals_status", "wallet_withdrawals", ["status"])

    existing_round_index = next(
        (
            item
            for item in _inspector().get_indexes("virtual_rounds")
            if item["name"] == "uq_virtual_rounds_single_open"
        ),
        None,
    )
    if existing_round_index is not None:
        op.drop_index("uq_virtual_rounds_single_open", table_name="virtual_rounds")
    op.create_index(
        "uq_virtual_rounds_single_open",
        "virtual_rounds",
        ["game_id", "participant_count"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
        sqlite_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    raise RuntimeError(
        "This schema reconciliation is intentionally forward-only to protect wallet data."
    )
