from copy import deepcopy
from secrets import SystemRandom
from typing import Any

SUITS = ("circle", "triangle", "cross", "square", "star")
HAND_SIZE = 5


def build_deck() -> list[dict[str, Any]]:
    cards = [
        {"id": f"{suit}-{number}", "suit": suit, "number": number}
        for suit in SUITS
        for number in range(1, 15)
    ]
    cards.extend(
        {"id": f"whot-{copy}", "suit": None, "number": 20}
        for copy in range(1, 6)
    )
    return cards


def initial_state(
    player_ids: list[int],
    deck: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if len(player_ids) not in (2, 3, 4) or len(set(player_ids)) != len(player_ids):
        raise ValueError("Whot requires 2-4 different players")

    cards = build_deck() if deck is None else deepcopy(deck)
    expected_ids = {card["id"] for card in build_deck()}
    if len(cards) != len(expected_ids) or {card["id"] for card in cards} != expected_ids:
        raise ValueError("A Whot deck must contain each card exactly once")
    if deck is None:
        SystemRandom().shuffle(cards)

    players = [{"user_id": player_id, "hand": []} for player_id in player_ids]
    for player in players:
        player["hand"] = [cards.pop() for _ in range(HAND_SIZE)]

    discard_index = next(
        index for index, card in enumerate(cards) if card["number"] != 20
    )
    first_discard = cards.pop(discard_index)
    return {
        "players": players,
        "draw_pile": cards,
        "discard_pile": [first_discard],
        "current_suit": first_discard["suit"],
        "turn_user_id": player_ids[0],
        "status": "active",
        "winner_user_id": None,
        "last_result": None,
    }


def legal_moves(state: dict[str, Any], player_id: int) -> list[str]:
    if state["status"] != "active" or state["turn_user_id"] != player_id:
        return []
    player = _player(state, player_id)
    if player is None:
        return []
    top_card = state["discard_pile"][-1]
    return [
        card["id"]
        for card in player["hand"]
        if card["number"] == 20
        or card["suit"] == state["current_suit"]
        or card["number"] == top_card["number"]
    ]


def play_card(
    state: dict[str, Any],
    player_id: int,
    card_id: str,
    chosen_suit: str | None = None,
) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The game has finished")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")

    player = _player(state, player_id)
    if player is None:
        raise ValueError("Player is not part of this game")
    card = next((candidate for candidate in player["hand"] if candidate["id"] == card_id), None)
    if card is None:
        raise ValueError("That card is not in your hand")
    if card_id not in legal_moves(state, player_id):
        raise ValueError("That card does not match the current suit or number")
    if card["number"] == 20 and chosen_suit not in SUITS:
        raise ValueError("Choose a suit when playing a WHOT card")
    if card["number"] != 20 and chosen_suit is not None:
        raise ValueError("Only a WHOT card can choose a suit")

    result = deepcopy(state)
    result_player = _player(result, player_id)
    played_card = next(
        candidate for candidate in result_player["hand"] if candidate["id"] == card_id
    )
    result_player["hand"].remove(played_card)
    result["discard_pile"].append(played_card)
    result["current_suit"] = chosen_suit if played_card["number"] == 20 else played_card["suit"]
    result["last_result"] = "played"

    if not result_player["hand"]:
        result["status"] = "finished"
        result["winner_user_id"] = player_id
        result["last_result"] = "won"
        return result

    if played_card["number"] in (1, 8):
        _advance_turn(result, player_id, steps=2)
        result["last_result"] = "held" if played_card["number"] == 1 else "suspended"
    elif played_card["number"] in (2, 5):
        penalty = 2 if played_card["number"] == 2 else 3
        next_player_id = _next_player_id(result, player_id)
        drawn = _draw_cards(result, next_player_id, penalty)
        _advance_turn(result, player_id, steps=2)
        result["last_result"] = f"drew_{drawn}_and_skipped"
    elif played_card["number"] == 14:
        for other_player in result["players"]:
            if other_player["user_id"] != player_id:
                _draw_cards(result, other_player["user_id"], 1)
        result["last_result"] = "general_market"
    else:
        _advance_turn(result, player_id)
    return result


def draw_card(state: dict[str, Any], player_id: int) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("The game has finished")
    if state["turn_user_id"] != player_id:
        raise ValueError("It is not your turn")
    if legal_moves(state, player_id):
        raise ValueError("Play a legal card instead of drawing")
    player = _player(state, player_id)
    if player is None:
        raise ValueError("Player is not part of this game")

    result = deepcopy(state)
    result_player = _player(result, player_id)
    card = _take_card(result)
    if card is not None:
        result_player["hand"].append(card)
        result["last_result"] = "drew_card"
    else:
        result["last_result"] = "draw_pile_empty"
    _advance_turn(result, player_id)
    return result


def _draw_cards(state: dict[str, Any], player_id: int, count: int) -> int:
    player = _player(state, player_id)
    if player is None:
        return 0
    drawn = 0
    for _ in range(count):
        card = _take_card(state)
        if card is None:
            break
        player["hand"].append(card)
        drawn += 1
    return drawn


def _take_card(state: dict[str, Any]) -> dict[str, Any] | None:
    if not state["draw_pile"] and len(state["discard_pile"]) > 1:
        top_card = state["discard_pile"].pop()
        recycled = state["discard_pile"]
        SystemRandom().shuffle(recycled)
        state["draw_pile"] = recycled
        state["discard_pile"] = [top_card]
    if not state["draw_pile"]:
        return None
    return state["draw_pile"].pop()


def _player(state: dict[str, Any], player_id: int) -> dict[str, Any] | None:
    return next(
        (player for player in state["players"] if player["user_id"] == player_id),
        None,
    )


def _next_player_id(state: dict[str, Any], current_player_id: int) -> int:
    current_index = next(
        index
        for index, player in enumerate(state["players"])
        if player["user_id"] == current_player_id
    )
    return state["players"][(current_index + 1) % len(state["players"])]["user_id"]


def _advance_turn(
    state: dict[str, Any],
    current_player_id: int,
    steps: int = 1,
) -> None:
    current_index = next(
        index
        for index, player in enumerate(state["players"])
        if player["user_id"] == current_player_id
    )
    next_index = (current_index + steps) % len(state["players"])
    state["turn_user_id"] = state["players"][next_index]["user_id"]
