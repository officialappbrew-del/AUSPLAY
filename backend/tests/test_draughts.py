import unittest

from app import draughts


class DraughtsEngineTests(unittest.TestCase):
    def setUp(self):
        self.state = draughts.initial_state(red_user_id=1, black_user_id=2)

    def test_initial_board_has_twelve_pieces_per_side(self):
        board = self.state["board"]
        self.assertEqual(sum(piece.lower() == "r" for row in board for piece in row), 12)
        self.assertEqual(sum(piece.lower() == "b" for row in board for piece in row), 12)
        self.assertEqual(len(draughts.legal_moves(self.state, 1)), 7)

    def test_mandatory_capture_blocks_other_pieces(self):
        self.state["board"] = self.empty_board()
        self.state["board"][4][1] = draughts.RED
        self.state["board"][6][7] = draughts.RED
        self.state["board"][3][2] = draughts.BLACK
        self.state["board"][1][6] = draughts.BLACK

        moves = draughts.legal_moves(self.state, 1)

        self.assertEqual(
            [(move["from_x"], move["from_y"], move["to_x"], move["to_y"]) for move in moves],
            [(1, 4, 3, 2)],
        )

    def test_multiple_capture_keeps_turn_with_same_piece(self):
        self.state["board"] = self.empty_board()
        self.state["board"][6][1] = draughts.RED
        self.state["board"][5][2] = draughts.BLACK
        self.state["board"][3][4] = draughts.BLACK
        self.state["board"][0][7] = draughts.BLACK

        after_first_jump = draughts.apply_move(self.state, 1, 1, 6, 3, 4)

        self.assertEqual(after_first_jump["turn_user_id"], 1)
        self.assertEqual(after_first_jump["forced_piece"], {"x": 3, "y": 4})
        self.assertEqual(
            [(move["from_x"], move["from_y"], move["to_x"], move["to_y"])
             for move in draughts.legal_moves(after_first_jump, 1)],
            [(3, 4, 5, 2)],
        )

        after_second_jump = draughts.apply_move(after_first_jump, 1, 3, 4, 5, 2)

        self.assertEqual(after_second_jump["turn_user_id"], 2)
        self.assertIsNone(after_second_jump["forced_piece"])

    def test_promotion_and_winning_capture(self):
        self.state["board"] = self.empty_board()
        self.state["board"][2][1] = draughts.RED
        self.state["board"][1][2] = draughts.BLACK

        result = draughts.apply_move(self.state, 1, 1, 2, 3, 0)

        self.assertEqual(result["board"][0][3], draughts.RED_KING)
        self.assertEqual(result["status"], "finished")
        self.assertEqual(result["winner_user_id"], 1)
        self.assertEqual(draughts.legal_moves(result, 2), [])

    def test_king_can_capture_backwards(self):
        self.state["board"] = self.empty_board()
        self.state["board"][4][3] = draughts.RED_KING
        self.state["board"][5][2] = draughts.BLACK
        self.state["board"][0][7] = draughts.BLACK

        moves = draughts.legal_moves(self.state, 1)

        self.assertIn(
            (3, 4, 1, 6),
            [
                (move["from_x"], move["from_y"], move["to_x"], move["to_y"])
                for move in moves
            ],
        )

    def test_non_player_and_illegal_move_are_rejected(self):
        self.assertEqual(draughts.legal_moves(self.state, 3), [])
        with self.assertRaisesRegex(ValueError, "not legal"):
            draughts.apply_move(self.state, 1, 1, 5, 2, 4)

    @staticmethod
    def empty_board():
        return [[draughts.EMPTY for _ in range(8)] for _ in range(8)]


if __name__ == "__main__":
    unittest.main()
