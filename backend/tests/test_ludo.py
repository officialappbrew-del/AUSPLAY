import unittest

from app import ludo


class LudoEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = ludo.initial_state([1, 2])

    def test_two_player_game_uses_opposite_colors_and_four_tokens(self):
        self.assertEqual(
            [(player["user_id"], player["color"]) for player in self.state["players"]],
            [(1, "red"), (2, "yellow")],
        )
        self.assertEqual(self.state["players"][0]["tokens"], [ludo.BASE] * 4)

    def test_six_can_leave_base_and_grants_another_turn(self):
        rolled = ludo.roll_die(self.state, 1, 6)
        self.assertEqual(len(ludo.legal_moves(rolled, 1)), 4)

        moved = ludo.move_token(rolled, 1, 0)

        self.assertEqual(moved["players"][0]["tokens"][0], 0)
        self.assertEqual(moved["turn_user_id"], 1)
        self.assertIsNone(moved["die_value"])

    def test_no_move_advances_turn_unless_roll_is_six(self):
        no_six_move = ludo.roll_die(self.state, 1, 4)
        self.assertEqual(no_six_move["turn_user_id"], 2)
        self.assertEqual(no_six_move["last_result"], "no_legal_move")

        no_six_move["turn_user_id"] = 1
        six = ludo.roll_die(no_six_move, 1, 6)
        self.assertEqual(six["turn_user_id"], 1)
        self.assertEqual(len(ludo.legal_moves(six, 1)), 4)

    def test_capture_sends_opponent_token_back_to_base(self):
        self.state["players"][0]["tokens"][0] = 8
        self.state["players"][1]["tokens"][0] = 35
        rolled = ludo.roll_die(self.state, 1, 1)

        moved = ludo.move_token(rolled, 1, 0)

        self.assertEqual(moved["players"][0]["tokens"][0], 9)
        self.assertEqual(moved["players"][1]["tokens"][0], ludo.BASE)
        self.assertEqual(moved["last_result"], "captured")

    def test_safe_square_prevents_capture(self):
        self.state["players"][0]["tokens"][0] = 7
        self.state["players"][1]["tokens"][0] = 34
        rolled = ludo.roll_die(self.state, 1, 1)

        moved = ludo.move_token(rolled, 1, 0)

        self.assertEqual(moved["players"][0]["tokens"][0], 8)
        self.assertEqual(moved["players"][1]["tokens"][0], 34)

    def test_blockade_prevents_passing(self):
        self.state["players"][0]["tokens"][0] = 0
        self.state["players"][1]["tokens"][0] = 28
        self.state["players"][1]["tokens"][1] = 28
        self.state["die_value"] = 3

        self.assertEqual(ludo.legal_moves(self.state, 1), [])

    def test_exact_roll_finishes_last_token_and_overshoot_is_rejected(self):
        self.state["players"][0]["tokens"] = [56, 57, 57, 57]
        rolled = ludo.roll_die(self.state, 1, 1)
        won = ludo.move_token(rolled, 1, 0)
        self.assertEqual(won["status"], "finished")
        self.assertEqual(won["winner_user_id"], 1)

        self.state["players"][0]["tokens"] = [56, ludo.BASE, ludo.BASE, ludo.BASE]
        overshoot = ludo.roll_die(self.state, 1, 2)
        self.assertEqual(overshoot["turn_user_id"], 2)
        self.assertEqual(ludo.legal_moves(overshoot, 1), [])

    def test_game_accepts_two_three_or_four_players(self):
        self.assertEqual(len(ludo.initial_state([1, 2, 3])["players"]), 3)
        self.assertEqual(len(ludo.initial_state([1, 2, 3, 4])["players"]), 4)
        with self.assertRaisesRegex(ValueError, "2-4"):
            ludo.initial_state([1])


if __name__ == "__main__":
    unittest.main()
