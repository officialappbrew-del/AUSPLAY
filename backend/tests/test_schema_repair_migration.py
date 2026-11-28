import importlib.util
import unittest
from datetime import datetime
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    inspect,
    insert,
    select,
)


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "c2f918d4a671_reconcile_wallet_virtual_schema.py"
)
SPEC = importlib.util.spec_from_file_location("schema_repair_migration", MIGRATION_PATH)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
SOURCE_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d6a30c1e49b2_allow_demo_round_sources.py"
)
SOURCE_SPEC = importlib.util.spec_from_file_location(
    "demo_round_source_migration",
    SOURCE_MIGRATION_PATH,
)
SOURCE_MIGRATION = importlib.util.module_from_spec(SOURCE_SPEC)
SOURCE_SPEC.loader.exec_module(SOURCE_MIGRATION)
LEGACY_BET_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e4b7f96a1c20_relax_legacy_virtual_bet_columns.py"
)
LEGACY_BET_SPEC = importlib.util.spec_from_file_location(
    "legacy_virtual_bet_migration",
    LEGACY_BET_MIGRATION_PATH,
)
LEGACY_BET_MIGRATION = importlib.util.module_from_spec(LEGACY_BET_SPEC)
LEGACY_BET_SPEC.loader.exec_module(LEGACY_BET_MIGRATION)
ROUND_SLOTS_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "b7e26f93a410_add_virtual_round_slots.py"
)
ROUND_SLOTS_SPEC = importlib.util.spec_from_file_location(
    "virtual_round_slots_migration",
    ROUND_SLOTS_MIGRATION_PATH,
)
ROUND_SLOTS_MIGRATION = importlib.util.module_from_spec(ROUND_SLOTS_SPEC)
ROUND_SLOTS_SPEC.loader.exec_module(ROUND_SLOTS_MIGRATION)


class SchemaRepairMigrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        metadata = MetaData()
        Table("users", metadata, Column("id", Integer, primary_key=True))
        Table(
            "practice_rooms",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("game_id", String(24), nullable=False),
            Column("name", String(40), nullable=False),
            Column("host_user_id", Integer, ForeignKey("users.id"), nullable=False),
            Column("max_players", Integer, nullable=False),
            Column("created_at", DateTime, nullable=False),
        )
        Table(
            "virtual_rounds",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("game_id", String(24), nullable=False),
            Column("source_game_id", Integer, nullable=False),
            Column("source_room_id", Integer, ForeignKey("practice_rooms.id"), nullable=False),
            Column("participant_count", Integer, nullable=False),
            Column("outcome_key", String(16), nullable=False),
            Column("odds", String, nullable=False),
            Column("sample_size", Integer, nullable=False),
            Column("status", String(16), nullable=False),
            Column("opened_at", DateTime, nullable=False),
            Column("closes_at", DateTime, nullable=False),
            Column("settled_at", DateTime),
            UniqueConstraint("game_id", "source_game_id"),
        )
        Table(
            "virtual_bets",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("round_id", Integer, ForeignKey("virtual_rounds.id"), nullable=False),
            Column("user_id", Integer, ForeignKey("users.id"), nullable=False),
            Column("outcome_key", String(16), nullable=False),
            Column("stake", Integer, nullable=False),
            Column("odds_milli", Integer, nullable=False),
            Column("payout", Integer),
            Column("created_at", DateTime, nullable=False),
            Column("updated_at", DateTime, nullable=False),
            UniqueConstraint("round_id", "user_id"),
        )
        metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            connection.execute(insert(metadata.tables["users"]), {"id": 1})
            connection.execute(insert(metadata.tables["users"]), {"id": 2})
            connection.execute(
                insert(metadata.tables["practice_rooms"]),
                {
                    "id": 1,
                    "game_id": "chess",
                    "name": "Historical room",
                    "host_user_id": 1,
                    "max_players": 2,
                    "created_at": datetime(2026, 11, 28),
                },
            )
            connection.execute(
                insert(metadata.tables["virtual_rounds"]),
                {
                    "id": 1,
                    "game_id": "chess",
                    "source_game_id": 1,
                    "source_room_id": 1,
                    "participant_count": 2,
                    "outcome_key": "player_1",
                    "odds": "{}",
                    "sample_size": 0,
                    "status": "open",
                    "opened_at": datetime(2026, 11, 28),
                    "closes_at": datetime(2026, 11, 28, 0, 1),
                },
            )
            connection.execute(
                insert(metadata.tables["virtual_bets"]),
                {
                    "id": 1,
                    "round_id": 1,
                    "user_id": 1,
                    "outcome_key": "player_1",
                    "stake": 25,
                    "odds_milli": 1500,
                    "payout": None,
                    "created_at": datetime(2026, 11, 28),
                    "updated_at": datetime(2026, 11, 28),
                },
            )
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX uq_virtual_rounds_single_open "
                "ON virtual_rounds (status) WHERE status = 'open'"
            )

    def tearDown(self):
        self.engine.dispose()

    def test_repairs_missing_objects_preserves_rows_and_is_repeatable(self):
        with self.engine.begin() as connection:
            operations = MigrationContext.configure(connection)
            with Operations.context(operations):
                MIGRATION.upgrade()
                MIGRATION.upgrade()
                SOURCE_MIGRATION.upgrade()
                LEGACY_BET_MIGRATION.upgrade()
                LEGACY_BET_MIGRATION.upgrade()
                ROUND_SLOTS_MIGRATION.upgrade()
                ROUND_SLOTS_MIGRATION.upgrade()

            schema = inspect(connection)
            expected_columns = {
                "practice_rooms": {"stake_kobo"},
                "virtual_rounds": {"is_demo", "commission_kobo", "slot_number"},
                "virtual_bets": {"stake_kobo", "payout_kobo"},
            }
            for table, expected in expected_columns.items():
                actual = {column["name"] for column in schema.get_columns(table)}
                self.assertTrue(expected.issubset(actual))
            for table in (
                "practice_match_settlements",
                "admin_wallet_topups",
                "wallet_withdrawals",
            ):
                self.assertTrue(schema.has_table(table))

            virtual_bets = Table(
                "virtual_bets",
                MetaData(),
                autoload_with=connection,
            )
            bet = connection.execute(
                select(virtual_bets.c.stake_kobo, virtual_bets.c.payout_kobo)
            ).one()
            self.assertEqual(bet.stake_kobo, 0)
            self.assertIsNone(bet.payout_kobo)

            round_indexes = {
                index["name"]: index for index in schema.get_indexes("virtual_rounds")
            }
            self.assertEqual(
                round_indexes["uq_virtual_rounds_single_open"]["column_names"],
                ["game_id", "participant_count", "slot_number"],
            )
            source_columns = {
                column["name"]: column
                for column in schema.get_columns("virtual_rounds")
            }
            self.assertTrue(source_columns["source_game_id"]["nullable"])
            self.assertTrue(source_columns["source_room_id"]["nullable"])
            self.assertEqual(
                connection.exec_driver_sql(
                    "SELECT slot_number FROM virtual_rounds WHERE id = 1"
                ).scalar_one(),
                1,
            )

            legacy_bet_columns = {
                column["name"]: column
                for column in schema.get_columns("virtual_bets")
            }
            self.assertTrue(legacy_bet_columns["stake"]["nullable"])
            self.assertTrue(legacy_bet_columns["odds_milli"]["nullable"])
            connection.execute(
                virtual_bets.insert().values(
                    id=2,
                    round_id=1,
                    user_id=2,
                    outcome_key="player_2",
                    stake_kobo=0,
                    payout_kobo=None,
                    created_at=datetime(2026, 11, 28),
                    updated_at=datetime(2026, 11, 28),
                )
            )

            virtual_rounds = Table(
                "virtual_rounds",
                MetaData(),
                autoload_with=connection,
            )
            connection.execute(
                virtual_rounds.insert().values(
                    id=2,
                    game_id="whot",
                    source_game_id=-1,
                    source_room_id=None,
                    participant_count=2,
                    outcome_key="draw",
                    odds="{}",
                    sample_size=0,
                    is_demo=True,
                    commission_kobo=0,
                    status="open",
                    opened_at=datetime(2026, 11, 28),
                    closes_at=datetime(2026, 11, 28, 0, 1),
                )
            )
            connection.execute(
                virtual_rounds.insert().values(
                    id=3,
                    game_id="chess",
                    source_game_id=2,
                    source_room_id=1,
                    participant_count=2,
                    slot_number=2,
                    outcome_key="player_2",
                    odds="{}",
                    sample_size=0,
                    is_demo=False,
                    commission_kobo=0,
                    status="open",
                    opened_at=datetime(2026, 11, 28),
                    closes_at=datetime(2026, 11, 28, 0, 1),
                )
            )
            self.assertIsNone(connection.execute(
                select(virtual_rounds.c.source_room_id).where(virtual_rounds.c.id == 2)
            ).scalar_one())


if __name__ == "__main__":
    unittest.main()
