from copy import deepcopy
from typing import Any


FRAMES_PER_MATCH = 3
MAX_BREAK_POINTS = 155
FRAMES_TO_WIN = FRAMES_PER_MATCH // 2 + 1


def initial_state(player_ids: list[int]) -> dict[str, Any]:
    if len(player_ids) != 2 or len(set(player_ids)) != 2:
        raise ValueError("Snooker scorecard matches require two different players")

    return {
        "frames": FRAMES_PER_MATCH,
        "frames_to_win": FRAMES_TO_WIN,
        "players": [
            {"user_id": player_id, "scores": [None] * FRAMES_PER_MATCH, "frame_wins": 0}
            for player_id in player_ids
        ],
        "current_frame": 1,
        "turn_index": 0,
        "turn_user_id": player_ids[0],
        "status": "active",
        "winner_user_ids": [],
    }


def submit_frame_score(
    state: dict[str, Any], player_id: int, break_points: int
) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The match has finished")
    if type(break_points) is not int or not 0 <= break_points <= MAX_BREAK_POINTS:
        raise ValueError(f"Break points must be between 0 and {MAX_BREAK_POINTS}")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")

    result = deepcopy(state)
    player = result["players"][result["turn_index"]]
    if player["user_id"] != player_id:
        raise ValueError("Player is not part of this match")
    player["scores"][result["current_frame"] - 1] = break_points

    if result["turn_index"] == 0:
        result["turn_index"] = 1
        result["turn_user_id"] = result["players"][1]["user_id"]
        return result

    first_score = result["players"][0]["scores"][result["current_frame"] - 1]
    second_score = result["players"][1]["scores"][result["current_frame"] - 1]
    if first_score > second_score:
        result["players"][0]["frame_wins"] += 1
    elif second_score > first_score:
        result["players"][1]["frame_wins"] += 1

    if (
        max(player["frame_wins"] for player in result["players"]) >= result["frames_to_win"]
        or result["current_frame"] == result["frames"]
    ):
        best_wins = max(player["frame_wins"] for player in result["players"])
        result["winner_user_ids"] = [
            player["user_id"]
            for player in result["players"]
            if player["frame_wins"] == best_wins
        ]
        result["status"] = "finished"
        result["turn_user_id"] = None
        return result

    result["current_frame"] += 1
    result["turn_index"] = 0
    result["turn_user_id"] = result["players"][0]["user_id"]
    return result
