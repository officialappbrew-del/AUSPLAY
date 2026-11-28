"""allow virtual bets without legacy stake and odds values

Revision ID: e4b7f96a1c20
Revises: d6a30c1e49b2
Create Date: 2026-11-28 18:52:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4b7f96a1c20"
down_revision: Union[str, Sequence[str], None] = "d6a30c1e49b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("virtual_bets"):
        return
    columns = {
        column["name"]: column
        for column in inspector.get_columns("virtual_bets")
    }
    for column_name in ("stake", "odds_milli"):
        column = columns.get(column_name)
        if column is None or column["nullable"]:
            continue
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("virtual_bets") as batch_op:
                batch_op.alter_column(
                    column_name,
                    existing_type=column["type"],
                    existing_nullable=False,
                    nullable=True,
                )
        else:
            op.alter_column(
                "virtual_bets",
                column_name,
                existing_type=column["type"],
                existing_nullable=False,
                nullable=True,
            )


def downgrade() -> None:
    raise RuntimeError(
        "This migration is intentionally forward-only to preserve existing virtual-bet data."
    )
