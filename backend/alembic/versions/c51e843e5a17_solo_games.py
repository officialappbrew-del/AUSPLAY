"""add persistent solo game sessions and progression

Revision ID: c51e843e5a17
Revises: 7f2aa7ab65c2
Create Date: 2026-11-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c51e843e5a17"
down_revision: Union[str, Sequence[str], None] = "7f2aa7ab65c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "solo_game_progress",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.String(length=24), nullable=False),
        sa.Column("highest_level", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "game_id"),
    )
    op.create_index(
        op.f("ix_solo_game_progress_game_id"),
        "solo_game_progress",
        ["game_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_solo_game_progress_user_id"),
        "solo_game_progress",
        ["user_id"],
        unique=False,
    )
    op.create_table(
        "solo_game_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.String(length=24), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_solo_game_sessions_game_id"),
        "solo_game_sessions",
        ["game_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_solo_game_sessions_user_id"),
        "solo_game_sessions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_solo_game_sessions_user_id"),
        table_name="solo_game_sessions",
    )
    op.drop_index(
        op.f("ix_solo_game_sessions_game_id"),
        table_name="solo_game_sessions",
    )
    op.drop_table("solo_game_sessions")
    op.drop_index(
        op.f("ix_solo_game_progress_user_id"),
        table_name="solo_game_progress",
    )
    op.drop_index(
        op.f("ix_solo_game_progress_game_id"),
        table_name="solo_game_progress",
    )
    op.drop_table("solo_game_progress")
