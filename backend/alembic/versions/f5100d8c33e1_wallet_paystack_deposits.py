"""add Paystack wallet deposits

Revision ID: f5100d8c33e1
Revises: e4d1b72c903a
Create Date: 2026-11-27 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f5100d8c33e1"
down_revision: Union[str, Sequence[str], None] = "e4d1b72c903a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wallet_deposits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("amount_kobo", sa.Integer(), nullable=False),
        sa.Column("reference", sa.String(length=80), nullable=False),
        sa.Column("authorization_url", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("status_detail", sa.String(length=240), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("amount_kobo > 0", name="ck_wallet_deposit_amount"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference"),
    )
    op.create_index("ix_wallet_deposits_user_id", "wallet_deposits", ["user_id"])
    op.create_index("ix_wallet_deposits_status", "wallet_deposits", ["status"])


def downgrade() -> None:
    op.drop_index("ix_wallet_deposits_status", table_name="wallet_deposits")
    op.drop_index("ix_wallet_deposits_user_id", table_name="wallet_deposits")
    op.drop_table("wallet_deposits")
