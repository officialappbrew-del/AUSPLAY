import hashlib
import hmac
import re
import secrets

SEED_PATTERN = re.compile(r"[0-9a-f]{64}")
HASH_SPACE = 1 << 256
ACCEPTED_HASH_LIMIT = HASH_SPACE - HASH_SPACE % 6


def new_server_seed() -> str:
    return secrets.token_hex(32)


def server_seed_commitment(server_seed: str) -> str:
    _validate_seed(server_seed, "server")
    return hashlib.sha256(bytes.fromhex(server_seed)).hexdigest()


def roll_value(server_seed: str, client_seed: str, nonce: int) -> int:
    _validate_seed(server_seed, "server")
    _validate_seed(client_seed, "client")
    if type(nonce) is not int or nonce < 0:
        raise ValueError("The roll nonce must be a non-negative integer")

    key = bytes.fromhex(server_seed)
    attempt = 0
    while True:
        message = f"{client_seed}:{nonce}:{attempt}".encode("ascii")
        digest = hmac.new(key, message, hashlib.sha256).digest()
        value = int.from_bytes(digest, "big")
        if value < ACCEPTED_HASH_LIMIT:
            return value % 6 + 1
        attempt += 1


def verify_roll(
    server_seed: str,
    client_seed: str,
    nonce: int,
    expected_value: int,
) -> bool:
    if type(expected_value) is not int or not 1 <= expected_value <= 6:
        return False
    return roll_value(server_seed, client_seed, nonce) == expected_value


def _validate_seed(seed: str, name: str) -> None:
    if not isinstance(seed, str) or not SEED_PATTERN.fullmatch(seed):
        raise ValueError(f"The {name} seed must be 32 bytes encoded as lowercase hex")
