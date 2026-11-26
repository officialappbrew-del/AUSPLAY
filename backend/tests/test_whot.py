import unittest

from app import whot


def card(suit, number, copy=1):
    card_id = f"whot-{copy}" if number == 20 else f"{suit}-{number}"
    return {"id": card_id, "suit": None if number == 20 else suit, "number": number}


def state(hands, current_suit="circle", top_card=None, draw_pile=None):
    return {
        "players": [
            {"user_id": player_id, "hand": hand}
            for player_id, hand in enumerate(hands, start=1)
        ],
        "draw_pile": list(draw_pile or []),
        "discard_pile": [top_card or card(current_suit, 3)],
        "current_suit": current_suit,
        "turn_user_id": 1,
        "status": "active",
        "winner_user_id": None,
        "last_result": None,
    }


class WhotEngineTests(unittest.TestCase):
    def test_initial_state_deals_five_cards_and_keeps_a_non_whot_discard(self):
        game = whot.initial_state([1, 2, 3], whot.build_deck())

        self.assertEqual([len(player["hand"]) for player in game["players"]], [5, 5, 5])
        self.assertNotEqual(game["discard_pile"][0]["number"], 20)
        self.assertEqual(game["current_suit"], game["discard_pile"][0]["suit"])
        self.assertEqual(
            len(game["draw_pile"])
            + sum(len(player["hand"]) for player in game["players"])
            + 1,
            75,
        )

    def test_legal_moves_match_suit_number_or_whot(self):
        game = state(
            [[
                card("triangle", 3),
                card("square", 7),
                card(None, 20),
                card("circle", 14),
            ], []],
            top_card=card("circle", 3),
        )

        self.assertEqual(
            whot.legal_moves(game, 1),
            ["triangle-3", "whot-1", "circle-14"],
        )
        self.assertEqual(whot.legal_moves(game, 2), [])

    def test_whot_requires_and_applies_a_chosen_suit(self):
        game = state([[card(None, 20), card("circle", 4)], [card("square", 9)]])

        with self.assertRaisesRegex(ValueError, "Choose a suit"):
            whot.play_card(game, 1, "whot-1")

        updated = whot.play_card(game, 1, "whot-1", "star")
        self.assertEqual(updated["current_suit"], "star")
        self.assertEqual(updated["turn_user_id"], 2)
        self.assertEqual(game["players"][0]["hand"], [card(None, 20), card("circle", 4)])

    def test_hold_and_suspension_skip_the_next_player(self):
        for number, expected_turn, result in ((1, 3, "held"), (8, 3, "suspended")):
            with self.subTest(number=number):
                game = state(
                    [
                        [card("circle", number), card("square", 9)],
                        [card("triangle", 6)],
                        [card("star", 7)],
                    ],
                    top_card=card("circle", 3),
                )

                updated = whot.play_card(game, 1, f"circle-{number}")

                self.assertEqual(updated["turn_user_id"], expected_turn)
                self.assertEqual(updated["last_result"], result)

    def test_hold_returns_the_turn_to_the_same_player_in_a_two_player_game(self):
        game = state(
            [[card("circle", 1), card("square", 9)], [card("triangle", 6)]],
            top_card=card("circle", 3),
        )

        updated = whot.play_card(game, 1, "circle-1")

        self.assertEqual(updated["turn_user_id"], 1)

    def test_pick_cards_penalty_draws_and_skips_the_next_player(self):
        for number, penalty in ((2, 2), (5, 3)):
            with self.subTest(number=number):
                draw_pile = [card("square", value) for value in range(1, penalty + 1)]
                game = state(
                    [
                        [card("circle", number), card("square", 9)],
                        [card("triangle", 6)],
                        [card("star", 7)],
                    ],
                    top_card=card("circle", 3),
                    draw_pile=draw_pile,
                )

                updated = whot.play_card(game, 1, f"circle-{number}")

                self.assertEqual(len(updated["players"][1]["hand"]), 1 + penalty)
                self.assertEqual(updated["turn_user_id"], 3)
                self.assertEqual(updated["last_result"], f"drew_{penalty}_and_skipped")

    def test_general_market_gives_each_opponent_a_card_and_keeps_the_turn(self):
        game = state(
            [
                [card("circle", 14), card("square", 9)],
                [card("triangle", 6)],
                [card("star", 7)],
            ],
            top_card=card("circle", 3),
            draw_pile=[card("square", 4), card("cross", 11)],
        )

        updated = whot.play_card(game, 1, "circle-14")

        self.assertEqual([len(player["hand"]) for player in updated["players"]], [1, 2, 2])
        self.assertEqual(updated["turn_user_id"], 1)
        self.assertEqual(updated["last_result"], "general_market")

    def test_draw_requires_no_legal_play_and_passes_after_drawing_one(self):
        game = state(
            [[card("triangle", 9)], [card("square", 7)]],
            draw_pile=[card("cross", 10)],
        )
        game["current_suit"] = "circle"

        updated = whot.draw_card(game, 1)

        self.assertEqual(len(updated["players"][0]["hand"]), 2)
        self.assertEqual(updated["turn_user_id"], 2)
        self.assertEqual(updated["last_result"], "drew_card")
        with self.assertRaisesRegex(ValueError, "Play a legal card"):
            whot.draw_card(state([[card("circle", 9)], []]), 1)

    def test_draw_recycles_the_discard_pile_without_the_top_card(self):
        top_card = card("circle", 3)
        game = state(
            [[card("triangle", 9)], [card("square", 7)]],
            top_card=top_card,
        )
        game["current_suit"] = "circle"
        game["discard_pile"] = [card("triangle", 4), top_card]

        updated = whot.draw_card(game, 1)

        self.assertEqual(updated["players"][0]["hand"][-1], card("triangle", 4))
        self.assertEqual(updated["discard_pile"], [top_card])

    def test_playing_the_last_card_wins(self):
        game = state([[card("circle", 9)], [card("square", 7)]])

        updated = whot.play_card(game, 1, "circle-9")

        self.assertEqual(updated["status"], "finished")
        self.assertEqual(updated["winner_user_id"], 1)
        self.assertEqual(updated["last_result"], "won")


if __name__ == "__main__":
    unittest.main()
