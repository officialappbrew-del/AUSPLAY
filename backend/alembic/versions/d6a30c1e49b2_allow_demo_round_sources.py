"""allow demo rounds without historical source rows

Revision ID: d6a30c1e49b2
Revises: c2f918d4a671
Create Date: 2026-11-28 18:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6a30c1e49b2"
down_revision: Union[str, Sequence[str], None] = "c2f918d4a671"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {
        column["name"]: column
        for column in inspector.get_columns("virtual_rounds")
    }
    for column_name in ("source_game_id", "source_room_id"):
        column = columns.get(column_name)
        if column is None or column["nullable"]:
            continue
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("virtual_rounds") as batch_op:
                batch_op.alter_column(
                    column_name,
                    existing_type=sa.Integer(),
                    nullable=True,
                )
        else:
            op.alter_column(
                "virtual_rounds",
                column_name,
                existing_type=sa.Integer(),
                nullable=True,
            )


def downgrade() -> None:
    raise RuntimeError(
        "This migration is intentionally forward-only because demo rounds may have null sources."
    )
