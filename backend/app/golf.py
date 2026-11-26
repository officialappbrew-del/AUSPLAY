from copy import deepcopy
from typing import Any


HOLE_PARS = [4, 4, 3, 5, 4, 3, 4, 5, 4]
MAX_STROKES_PER_HOLE = 15


def initial_state(player_ids: list[int]) -> dict[str, Any]:
    if not 2 <= len(player_ids) <= 4 or len(set(player_ids)) != len(player_ids):
        raise ValueError("Golf requires 2-4 different players")

    return {
        "pars": HOLE_PARS[:],
        "players": [
            {"user_id": user_id, "scores": [None] * len(HOLE_PARS)}
            for user_id in player_ids
        ],
        "current_hole": 1,
        "turn_index": 0,
        "turn_user_id": player_ids[0],
        "status": "active",
        "winner_user_ids": [],
    }


def submit_score(state: dict[str, Any], player_id: int, strokes: int) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The game has finished")
    if type(strokes) is not int or not 1 <= strokes <= MAX_STROKES_PER_HOLE:
        raise ValueError(f"Strokes must be between 1 and {MAX_STROKES_PER_HOLE}")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")

    result = deepcopy(state)
    player = result["players"][result["turn_index"]]
    if player["user_id"] != player_id:
        raise ValueError("Player is not part of this game")
    player["scores"][result["current_hole"] - 1] = strokes

    if result["turn_index"] + 1 < len(result["players"]):
        result["turn_index"] += 1
        result["turn_user_id"] = result["players"][result["turn_index"]]["user_id"]
        return result

    if result["current_hole"] == len(result["pars"]):
        totals = [
            sum(score for score in golfer["scores"] if score is not None)
            for golfer in result["players"]
        ]
        best_score = min(totals)
        result["winner_user_ids"] = [
            golfer["user_id"]
            for golfer, total in zip(result["players"], totals)
            if total == best_score
        ]
        result["status"] = "finished"
        result["turn_user_id"] = None
        return result

    result["current_hole"] += 1
    result["turn_index"] = 0
    result["turn_user_id"] = result["players"][0]["user_id"]
    return result
