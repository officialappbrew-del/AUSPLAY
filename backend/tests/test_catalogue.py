import unittest

from app.main import games


class GameCatalogueTests(unittest.TestCase):
    def test_ps5_is_listed_as_a_non_playable_platform(self):
        ps5 = next(game for game in games() if game["id"] == "ps5")

        self.assertEqual(ps5["name"], "PS5")
        self.assertFalse(ps5["playable"])
        self.assertIn("not playable yet", ps5["description"])
