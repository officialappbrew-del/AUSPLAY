import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import draughts, ludo, main, models, whot
from app.db import Base


class HostWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_dir.name}/test.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False)
        with self.session_factory() as db:
            player = models.User(username="player", password_hash="unused")
            admin = models.User(username="admin", password_hash="unused", role="admin")
            target = models.User(username="target", password_hash="unused")
            db.add_all([player, admin, target])
            db.flush()
            room = models.PracticeRoom(
                game_id="draughts",
                name="Community room",
                host_user_id=target.id,
                max_players=2,
            )
            db.add(room)
            db.flush()
            db.add(
                models.PracticeRoomSeat(
                    room_id=room.id,
                    user_id=target.id,
                    seat_number=1,
                )
            )
            db.commit()
            self.player_id = player.id
            self.admin_id = admin.id
            self.target_id = target.id
            self.room_id = room.id

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_host_application_approval_unlocks_rule_proposals(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            admin = db.get(models.User, self.admin_id)
            application = main.request_host_role(
                main.HostApplicationRequest(
                    motivation="I want to organize welcoming weekly games for new players."
                ),
                player,
                db,
            )
            approved = main.review_host_application(
                application["id"],
                main.ReviewDecision(decision="approve", note="Approved."),
                admin,
                db,
            )

            self.assertEqual(approved["role"], "host")
            proposal = main.propose_rulebook(
                main.RuleProposalRequest(
                    game_id="draughts",
                    title="Community Draughts",
                    content=(
                        "This proposal clearly describes the current server-enforced "
                        "Draughts rules for community players."
                    ),
                ),
                player,
                db,
            )
            published = main.review_rule_proposal(
                proposal["id"],
                main.ReviewDecision(decision="approve"),
                admin,
                db,
            )
            rulebook = main.published_rulebooks(db)["draughts"]

        self.assertEqual(published["status"], "approved")
        self.assertEqual(rulebook["title"], "Community Draughts")
        self.assertEqual(rulebook["version"], 1)

    def test_player_cannot_access_admin_or_host_tools(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            with self.assertRaises(HTTPException) as admin_error:
                main.admin_host_applications("pending", player, db)
            with self.assertRaises(HTTPException) as host_error:
                main.propose_rulebook(
                    main.RuleProposalRequest(
                        game_id="ludo",
                        title="Unauthorized rules",
                        content="This player has not received host approval yet.",
                    ),
                    player,
                    db,
                )

        self.assertEqual(admin_error.exception.status_code, 403)
        self.assertEqual(host_error.exception.status_code, 403)

    def test_moderation_report_can_be_triaged_by_admin(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            admin = db.get(models.User, self.admin_id)
            report = main.submit_moderation_report(
                main.ModerationReportRequest(
                    room_id=self.room_id,
                    target_user_id=self.target_id,
                    category="cheating",
                    details="The reported player repeatedly ignored the server-validated turns.",
                ),
                player,
                db,
            )
            queue = main.admin_moderation_reports("open", admin, db)
            reviewed = main.review_moderation_report(
                report["id"],
                main.ModerationReview(
                    decision="resolve",
                    resolution="Reviewed the report and recorded the follow-up action.",
                ),
                admin,
                db,
            )
            stored = db.scalar(
                select(models.ModerationReport).where(
                    models.ModerationReport.id == report["id"]
                )
            )

        self.assertEqual(queue[0]["target_username"], "target")
        self.assertEqual(reviewed["status"], "resolved")
        self.assertEqual(stored.resolution, "Reviewed the report and recorded the follow-up action.")

    def test_responsible_play_settings_default_and_persist(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            default = main.get_responsible_play_settings(player, db)
            saved = main.update_responsible_play_settings(
                main.ResponsiblePlaySettingsRequest(break_reminder_minutes=30),
                player,
                db,
            )
            loaded = main.get_responsible_play_settings(player, db)
            disabled = main.update_responsible_play_settings(
                main.ResponsiblePlaySettingsRequest(break_reminder_minutes=0),
                player,
                db,
            )

        self.assertEqual(default["break_reminder_minutes"], 60)
        self.assertEqual(saved["break_reminder_minutes"], 30)
        self.assertEqual(loaded["break_reminder_minutes"], 30)
        self.assertEqual(disabled["break_reminder_minutes"], 0)

    def test_dispute_snapshot_does_not_expose_whot_hands_or_draw_pile(self):
        state = whot.initial_state([1, 2])

        snapshot = main._game_dispute_snapshot("whot", state)

        self.assertNotIn("draw_pile", snapshot)
        self.assertNotIn("discard_pile", snapshot)
        self.assertTrue(all("hand" not in player for player in snapshot["players"]))
        self.assertEqual(snapshot["players"][0]["card_count"], 5)

    def test_dispute_snapshot_does_not_expose_ludo_server_seed(self):
        state = ludo.initial_state([1, 2])
        state["_fairness"] = {"server_seed": "private"}

        snapshot = main._game_dispute_snapshot("ludo", state)

        self.assertNotIn("_fairness", snapshot)

    def test_only_a_seated_player_can_dispute_a_finished_game(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            admin = db.get(models.User, self.admin_id)
            target = db.get(models.User, self.target_id)
            db.add(
                models.PracticeRoomSeat(
                    room_id=self.room_id,
                    user_id=player.id,
                    seat_number=2,
                )
            )
            state = draughts.initial_state(target.id, player.id)
            state["status"] = "finished"
            state["winner_user_id"] = target.id
            db.add(
                models.DraughtsGame(
                    room_id=self.room_id,
                    red_player_id=target.id,
                    black_player_id=player.id,
                    state=state,
                    status="finished",
                    version=4,
                )
            )
            db.commit()

            dispute = main.submit_game_dispute(
                self.room_id,
                main.GameDisputeRequest(
                    details="The recorded final board appears inconsistent with the last accepted move."
                ),
                player,
                db,
            )
            with self.assertRaises(HTTPException) as duplicate_dispute:
                main.submit_game_dispute(
                    self.room_id,
                    main.GameDisputeRequest(
                        details="The same player submitted a duplicate open dispute."
                    ),
                    player,
                    db,
                )
            queue = main.admin_game_disputes("open", admin, db)
            reviewed = main.review_game_dispute(
                dispute["id"],
                main.ModerationReview(
                    decision="resolve",
                    resolution="The recorded event history was reviewed and the result stands.",
                ),
                admin,
                db,
            )
            listed = main.get_my_game_dispute(self.room_id, player, db)

        self.assertEqual(dispute["game_version"], 4)
        self.assertEqual(duplicate_dispute.exception.status_code, 409)
        self.assertEqual(queue[0]["reporter"], "player")
        self.assertEqual(reviewed["status"], "resolved")
        self.assertEqual(listed["resolution"], "The recorded event history was reviewed and the result stands.")

    def test_active_game_and_unseated_user_cannot_dispute(self):
        with self.session_factory() as db:
            player = db.get(models.User, self.player_id)
            with self.assertRaises(HTTPException) as not_seated:
                main.submit_game_dispute(
                    self.room_id,
                    main.GameDisputeRequest(
                        details="I am not seated in this room but would like to dispute."
                    ),
                    player,
                    db,
                )
            db.add(
                models.PracticeRoomSeat(
                    room_id=self.room_id,
                    user_id=player.id,
                    seat_number=2,
                )
            )
            db.add(
                models.DraughtsGame(
                    room_id=self.room_id,
                    red_player_id=self.target_id,
                    black_player_id=player.id,
                    state=draughts.initial_state(self.target_id, player.id),
                    status="active",
                )
            )
            db.commit()
            with self.assertRaises(HTTPException) as game_active:
                main.submit_game_dispute(
                    self.room_id,
                    main.GameDisputeRequest(
                        details="I am trying to dispute before this match is finished."
                    ),
                    player,
                    db,
                )

        self.assertEqual(not_seated.exception.status_code, 403)
        self.assertEqual(game_active.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
