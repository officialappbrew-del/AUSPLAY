from copy import deepcopy
from typing import Any

TRACK_SIZE = 52
HOME_PROGRESS = 57
BASE = -1
SAFE_SQUARES = {0, 8, 13, 21, 26, 34, 39, 47}
COLOR_STARTS = {"red": 0, "green": 13, "yellow": 26, "blue": 39}
COLOR_ORDERS = {
    2: ("red", "yellow"),
    3: ("red", "green", "yellow"),
    4: ("red", "green", "yellow", "blue"),
}


def initial_state(player_ids: list[int]) -> dict[str, Any]:
    if len(player_ids) not in COLOR_ORDERS or len(set(player_ids)) != len(player_ids):
        raise ValueError("Ludo requires 2-4 different players")

    players = [
        {
            "user_id": user_id,
            "color": color,
            "start_index": COLOR_STARTS[color],
            "tokens": [BASE, BASE, BASE, BASE],
        }
        for user_id, color in zip(player_ids, COLOR_ORDERS[len(player_ids)])
    ]
    return {
        "players": players,
        "turn_user_id": player_ids[0],
        "die_value": None,
        "last_roll": None,
        "last_result": None,
        "status": "active",
        "winner_user_id": None,
    }


def legal_moves(state: dict[str, Any], player_id: int) -> list[dict[str, Any]]:
    if (
        state["status"] != "active"
        or state["turn_user_id"] != player_id
        or state["die_value"] is None
    ):
        return []

    player = _player(state, player_id)
    if player is None:
        return []

    moves = []
    for token_index, progress in enumerate(player["tokens"]):
        destination = _destination(progress, state["die_value"])
        if destination is None:
            continue
        if _path_has_blockade(state, player, token_index, progress, destination):
            continue
        captures = _captures_at_destination(state, player, destination)
        moves.append(
            {
                "token_index": token_index,
                "from_progress": progress,
                "to_progress": destination,
                "captures": captures,
            }
        )
    return moves


def roll_die(
    state: dict[str, Any], player_id: int, value: int
) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The game has finished")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")
    if state["die_value"] is not None:
        raise ValueError("Move a token before rolling again")
    if type(value) is not int or not 1 <= value <= 6:
        raise ValueError("A die roll must be between 1 and 6")

    result = deepcopy(state)
    result["die_value"] = value
    result["last_roll"] = value
    result["last_result"] = None
    if not legal_moves(result, player_id):
        result["die_value"] = None
        result["last_result"] = "no_legal_move"
        if value != 6:
            _advance_turn(result, player_id)
    return result


def move_token(
    state: dict[str, Any], player_id: int, token_index: int
) -> dict[str, Any]:
    move = next(
        (
            candidate
            for candidate in legal_moves(state, player_id)
            if candidate["token_index"] == token_index
        ),
        None,
    )
    if move is None:
        raise ValueError("That token cannot move")

    result = deepcopy(state)
    player = _player(result, player_id)
    if player is None:
        raise ValueError("Player is not part of this game")

    roll = result["die_value"]
    player["tokens"][token_index] = move["to_progress"]
    captured_count = 0
    for capture in move["captures"]:
        victim = _player(result, capture["user_id"])
        if victim is not None:
            victim["tokens"][capture["token_index"]] = BASE
            captured_count += 1

    result["die_value"] = None
    result["last_result"] = "captured" if captured_count else "moved"
    if all(progress == HOME_PROGRESS for progress in player["tokens"]):
        result["status"] = "finished"
        result["winner_user_id"] = player_id
    elif roll != 6:
        _advance_turn(result, player_id)
    return result


def _destination(progress: int, roll: int) -> int | None:
    if progress == BASE:
        return 0 if roll == 6 else None
    destination = progress + roll
    if progress >= HOME_PROGRESS or destination > HOME_PROGRESS:
        return None
    return destination


def _path_has_blockade(
    state: dict[str, Any],
    player: dict[str, Any],
    token_index: int,
    progress: int,
    destination: int,
) -> bool:
    for step in range(progress + 1, min(destination, TRACK_SIZE - 1) + 1):
        square = (player["start_index"] + step) % TRACK_SIZE
        occupants = 0
        for other_player in state["players"]:
            for other_index, other_progress in enumerate(other_player["tokens"]):
                if (
                    other_progress < 0
                    or other_progress >= TRACK_SIZE
                    or (other_player["user_id"] == player["user_id"] and other_index == token_index)
                ):
                    continue
                if (other_player["start_index"] + other_progress) % TRACK_SIZE == square:
                    occupants += 1
        if occupants >= 2:
            return True
    return False


def _captures_at_destination(
    state: dict[str, Any],
    player: dict[str, Any],
    destination: int,
) -> list[dict[str, int]]:
    if destination >= TRACK_SIZE:
        return []

    square = (player["start_index"] + destination) % TRACK_SIZE
    if square in SAFE_SQUARES:
        return []

    captures = []
    for other_player in state["players"]:
        if other_player["user_id"] == player["user_id"]:
            continue
        for other_index, other_progress in enumerate(other_player["tokens"]):
            if (
                other_progress >= 0
                and other_progress < TRACK_SIZE
                and (other_player["start_index"] + other_progress) % TRACK_SIZE == square
            ):
                captures.append(
                    {"user_id": other_player["user_id"], "token_index": other_index}
                )
    return captures


def _player(state: dict[str, Any], player_id: int) -> dict[str, Any] | None:
    return next(
        (player for player in state["players"] if player["user_id"] == player_id),
        None,
    )


def _advance_turn(state: dict[str, Any], current_player_id: int) -> None:
    current_index = next(
        index
        for index, player in enumerate(state["players"])
        if player["user_id"] == current_player_id
    )
    next_index = (current_index + 1) % len(state["players"])
    state["turn_user_id"] = state["players"][next_index]["user_id"]
