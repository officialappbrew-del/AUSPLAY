"""add player profiles and account recovery tokens

Revision ID: d3842dc7bc26
Revises: c51e843e5a17
Create Date: 2026-11-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d3842dc7bc26"
down_revision: Union[str, Sequence[str], None] = "c51e843e5a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(length=254), nullable=True))
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("auth_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_table(
        "account_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index(
        op.f("ix_account_tokens_purpose"),
        "account_tokens",
        ["purpose"],
        unique=False,
    )
    op.create_index(
        op.f("ix_account_tokens_user_id"),
        "account_tokens",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_account_tokens_user_id"), table_name="account_tokens")
    op.drop_index(op.f("ix_account_tokens_purpose"), table_name="account_tokens")
    op.drop_table("account_tokens")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "auth_version")
    op.drop_column("users", "email")
    op.drop_column("users", "display_name")
