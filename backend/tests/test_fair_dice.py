import hashlib
import unittest

from app import fair_dice


class FairDiceTests(unittest.TestCase):
    def setUp(self):
        self.server_seed = "0" * 64
        self.client_seed = "1" * 64

    def test_server_seed_commitment_is_sha256_of_seed_bytes(self):
        expected = hashlib.sha256(bytes.fromhex(self.server_seed)).hexdigest()

        self.assertEqual(fair_dice.server_seed_commitment(self.server_seed), expected)

    def test_roll_is_deterministic_and_within_die_range(self):
        values = [
            fair_dice.roll_value(self.server_seed, self.client_seed, nonce)
            for nonce in range(128)
        ]

        self.assertTrue(all(1 <= value <= 6 for value in values))
        self.assertEqual(
            fair_dice.roll_value(self.server_seed, self.client_seed, 17),
            fair_dice.roll_value(self.server_seed, self.client_seed, 17),
        )
        self.assertEqual(fair_dice.roll_value(self.server_seed, self.client_seed, 17), 2)

    def test_roll_verification_detects_a_changed_result(self):
        value = fair_dice.roll_value(self.server_seed, self.client_seed, 5)

        self.assertTrue(fair_dice.verify_roll(self.server_seed, self.client_seed, 5, value))
        self.assertFalse(fair_dice.verify_roll(self.server_seed, self.client_seed, 5, value % 6 + 1))
        self.assertFalse(fair_dice.verify_roll(self.server_seed, self.client_seed, 5, True))

    def test_invalid_seeds_and_nonces_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "server seed"):
            fair_dice.server_seed_commitment("not-a-seed")
        with self.assertRaisesRegex(ValueError, "client seed"):
            fair_dice.roll_value(self.server_seed, "bad", 0)
        with self.assertRaisesRegex(ValueError, "nonce"):
            fair_dice.roll_value(self.server_seed, self.client_seed, -1)


if __name__ == "__main__":
    unittest.main()
