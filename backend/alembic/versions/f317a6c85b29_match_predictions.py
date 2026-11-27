"""add opt-in match predictions

Revision ID: f317a6c85b29
Revises: d3842dc7bc26
Create Date: 2026-11-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f317a6c85b29"
down_revision: Union[str, Sequence[str], None] = "d3842dc7bc26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "room_prediction_consents",
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["practice_rooms.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("room_id", "user_id"),
    )
    op.create_table(
        "match_predictions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("predicted_winner_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "predicts_draw",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["predicted_winner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["room_id"], ["practice_rooms.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(predicts_draw AND predicted_winner_user_id IS NULL) OR "
            "(NOT predicts_draw AND predicted_winner_user_id IS NOT NULL)",
            name="ck_match_predictions_outcome",
        ),
        sa.UniqueConstraint("room_id", "user_id"),
    )
    op.create_index(
        op.f("ix_match_predictions_room_id"),
        "match_predictions",
        ["room_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_match_predictions_user_id"),
        "match_predictions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_match_predictions_user_id"), table_name="match_predictions")
    op.drop_index(op.f("ix_match_predictions_room_id"), table_name="match_predictions")
    op.drop_table("match_predictions")
    op.drop_table("room_prediction_consents")
