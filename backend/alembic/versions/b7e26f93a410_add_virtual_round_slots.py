"""support multiple concurrent virtual sets per game

Revision ID: b7e26f93a410
Revises: e4b7f96a1c20
Create Date: 2026-11-28 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e26f93a410"
down_revision: Union[str, Sequence[str], None] = "e4b7f96a1c20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("virtual_rounds"):
        return

    columns = {column["name"] for column in inspector.get_columns("virtual_rounds")}
    if "slot_number" not in columns:
        op.add_column(
            "virtual_rounds",
            sa.Column(
                "slot_number",
                sa.Integer(),
                server_default=sa.text("1"),
                nullable=False,
            ),
        )

    indexes = {index["name"] for index in inspector.get_indexes("virtual_rounds")}
    if "uq_virtual_rounds_single_open" in indexes:
        op.drop_index("uq_virtual_rounds_single_open", table_name="virtual_rounds")
    op.create_index(
        "uq_virtual_rounds_single_open",
        "virtual_rounds",
        ["game_id", "participant_count", "slot_number"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
        sqlite_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    raise RuntimeError(
        "This migration is intentionally forward-only to preserve active virtual rounds."
    )
