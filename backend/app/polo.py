from copy import deepcopy
from typing import Any


CHUKKAS = 4
MAX_GOALS_PER_CHUKKA = 20


def initial_state(player_ids: list[int]) -> dict[str, Any]:
    if len(player_ids) != 2 or len(set(player_ids)) != 2:
        raise ValueError("Polo scorecard matches require two different team captains")

    return {
        "chukkas": CHUKKAS,
        "teams": [
            {"user_id": player_id, "goals": [None] * CHUKKAS}
            for player_id in player_ids
        ],
        "current_chukka": 1,
        "turn_index": 0,
        "turn_user_id": player_ids[0],
        "status": "active",
        "winner_user_ids": [],
    }


def submit_goals(state: dict[str, Any], player_id: int, goals: int) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The game has finished")
    if type(goals) is not int or not 0 <= goals <= MAX_GOALS_PER_CHUKKA:
        raise ValueError(f"Goals must be between 0 and {MAX_GOALS_PER_CHUKKA}")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")

    result = deepcopy(state)
    team = result["teams"][result["turn_index"]]
    if team["user_id"] != player_id:
        raise ValueError("Player is not part of this game")
    team["goals"][result["current_chukka"] - 1] = goals

    if result["turn_index"] == 0:
        result["turn_index"] = 1
        result["turn_user_id"] = result["teams"][1]["user_id"]
        return result

    if result["current_chukka"] == result["chukkas"]:
        totals = [sum(score for score in team["goals"] if score is not None) for team in result["teams"]]
        best_score = max(totals)
        result["winner_user_ids"] = [
            team["user_id"]
            for team, total in zip(result["teams"], totals)
            if total == best_score
        ]
        result["status"] = "finished"
        result["turn_user_id"] = None
        return result

    result["current_chukka"] += 1
    result["turn_index"] = 0
    result["turn_user_id"] = result["teams"][0]["user_id"]
    return result
