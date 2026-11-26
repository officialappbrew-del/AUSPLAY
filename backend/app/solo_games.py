from secrets import choice, randbelow
from typing import Any

import chess

from . import chess_game, golf, ludo, polo, snooker, whot


GAME_NAMES = {
    "chess": "Chess",
    "golf": "Golf",
    "ludo": "Ludo",
    "polo": "Polo",
    "snooker": "Snooker",
    "whot": "Whot",
}
MAX_LEVEL = 100
COMPUTER_TURN_LIMIT = 128
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}


def initial_state(game_id: str, user_id: int) -> dict[str, Any]:
    computer_id = -user_id
    if game_id == "chess":
        return chess_game.initial_state(user_id, computer_id)
    if game_id == "golf":
        return golf.initial_state([user_id, computer_id])
    if game_id == "ludo":
        return ludo.initial_state([user_id, computer_id])
    if game_id == "polo":
        return polo.initial_state([user_id, computer_id])
    if game_id == "snooker":
        return snooker.initial_state([user_id, computer_id])
    if game_id == "whot":
        return whot.initial_state([user_id, computer_id])
    raise ValueError("Solo play is not available for this game")


def apply_player_action(
    game_id: str,
    state: dict[str, Any],
    user_id: int,
    level: int,
    action: dict[str, Any],
) -> dict[str, Any]:
    if state["status"] != "active":
        raise ValueError("This solo game has finished")
    computer_id = -user_id
    action_type = action.get("action")

    if game_id == "chess":
        if action_type != "move" or not isinstance(action.get("uci"), str):
            raise ValueError("Choose a legal chess move")
        result = chess_game.apply_move(state, user_id, action["uci"])
        if result["status"] == "active" and result["turn_user_id"] == computer_id:
            result = chess_game.apply_move(
                result,
                computer_id,
                _choose_chess_move(result, level),
            )
        return result

    if game_id == "ludo":
        if action_type == "roll":
            result = ludo.roll_die(state, user_id, randbelow(6) + 1)
        elif action_type == "token" and type(action.get("token_index")) is int:
            result = ludo.move_token(state, user_id, action["token_index"])
        else:
            raise ValueError("Roll the die or choose a legal token")
        return _play_ludo_computer_turns(result, computer_id, level)

    if game_id == "whot":
        if action_type == "play_card":
            card_id = action.get("card_id")
            if not isinstance(card_id, str):
                raise ValueError("Choose a card from your hand")
            result = whot.play_card(
                state,
                user_id,
                card_id,
                action.get("chosen_suit"),
            )
        elif action_type == "draw":
            result = whot.draw_card(state, user_id)
        else:
            raise ValueError("Play a legal card or draw")
        return _play_whot_computer_turns(result, computer_id, level)

    value = action.get("value")
    if action_type != "score" or type(value) is not int:
        raise ValueError("Submit a valid score")
    if game_id == "golf":
        result = golf.submit_score(state, user_id, value)
        if result["status"] == "active" and result["turn_user_id"] == computer_id:
            par = result["pars"][result["current_hole"] - 1]
            result = golf.submit_score(
                result,
                computer_id,
                _computer_golf_score(par, level),
            )
        return result
    if game_id == "polo":
        result = polo.submit_goals(state, user_id, value)
        if result["status"] == "active" and result["turn_user_id"] == computer_id:
            result = polo.submit_goals(
                result,
                computer_id,
                _computer_polo_goals(level),
            )
        return result
    if game_id == "snooker":
        result = snooker.submit_frame_score(state, user_id, value)
        if result["status"] == "active" and result["turn_user_id"] == computer_id:
            result = snooker.submit_frame_score(
                result,
                computer_id,
                _computer_snooker_break(level),
            )
        return result
    raise ValueError("Solo play is not available for this game")


def player_won(state: dict[str, Any], user_id: int) -> bool:
    winner_ids = state.get("winner_user_ids")
    if winner_ids is not None:
        return len(winner_ids) == 1 and winner_ids[0] == user_id
    return state.get("winner_user_id") == user_id


def _play_ludo_computer_turns(
    state: dict[str, Any], computer_id: int, level: int
) -> dict[str, Any]:
    for _ in range(COMPUTER_TURN_LIMIT):
        if state["status"] != "active" or state["turn_user_id"] != computer_id:
            return state
        state = ludo.roll_die(state, computer_id, randbelow(6) + 1)
        moves = ludo.legal_moves(state, computer_id)
        if moves:
            state = ludo.move_token(
                state,
                computer_id,
                _choose_ludo_token(moves, level),
            )
    if state["status"] == "active" and state["turn_user_id"] == computer_id:
        raise ValueError("The computer took too many turns; submit your move again")
    return state


def _choose_ludo_token(moves: list[dict[str, Any]], level: int) -> int:
    def score(move: dict[str, Any]) -> int:
        return (
            (1000 if move["to_progress"] == ludo.HOME_PROGRESS else 0)
            + len(move["captures"]) * 200
            + (80 if move["from_progress"] == ludo.BASE else 0)
            + move["to_progress"]
        )

    scored = [(score(move), move["token_index"]) for move in moves]
    best = max(value for value, _ in scored)
    tolerance = (MAX_LEVEL - level) * 2
    candidates = [index for value, index in scored if value >= best - tolerance]
    return choice(candidates)


def _play_whot_computer_turns(
    state: dict[str, Any], computer_id: int, level: int
) -> dict[str, Any]:
    for _ in range(COMPUTER_TURN_LIMIT):
        if state["status"] != "active" or state["turn_user_id"] != computer_id:
            return state
        moves = whot.legal_moves(state, computer_id)
        if not moves:
            state = whot.draw_card(state, computer_id)
            continue
        card_id, chosen_suit = _choose_whot_card(state, computer_id, moves, level)
        state = whot.play_card(state, computer_id, card_id, chosen_suit)
    if state["status"] == "active" and state["turn_user_id"] == computer_id:
        raise ValueError("The computer took too many turns; submit your move again")
    return state


def _choose_whot_card(
    state: dict[str, Any],
    computer_id: int,
    moves: list[str],
    level: int,
) -> tuple[str, str | None]:
    hand = next(player["hand"] for player in state["players"] if player["user_id"] == computer_id)
    cards = {card["id"]: card for card in hand}
    suit_counts = {
        suit: sum(card["suit"] == suit for card in hand)
        for suit in whot.SUITS
    }

    def score(card_id: str) -> int:
        card = cards[card_id]
        action_value = {1: 20, 2: 35, 5: 40, 8: 25, 14: 45, 20: -5}.get(
            card["number"], 0
        )
        matching_cards = suit_counts.get(card["suit"], 0) if card["suit"] else 0
        return action_value + matching_cards * 4

    scored = [(score(card_id), card_id) for card_id in moves]
    best = max(value for value, _ in scored)
    tolerance = (MAX_LEVEL - level) // 2
    candidates = [card_id for value, card_id in scored if value >= best - tolerance]
    card_id = choice(candidates)
    card = cards[card_id]
    if card["number"] != 20:
        return card_id, None
    suit = max(whot.SUITS, key=lambda candidate: suit_counts[candidate])
    return card_id, suit


def _computer_golf_score(par: int, level: int) -> int:
    expected_over_par = 3 - round((level - 1) * 0.05)
    variation = randbelow(5) - 2
    return min(15, max(1, par + expected_over_par + variation))


def _computer_polo_goals(level: int) -> int:
    expected_goals = 1 + round((level - 1) * 0.04)
    return min(20, max(0, expected_goals + randbelow(5) - 2))


def _computer_snooker_break(level: int) -> int:
    expected_break = 5 + round(level * 0.9)
    return min(155, max(0, expected_break + randbelow(61) - 30))


def _choose_chess_move(state: dict[str, Any], level: int) -> str:
    board = chess.Board(state["initial_fen"])
    for played in state["moves"]:
        board.push_uci(played["uci"])

    computer_color = chess.BLACK
    search_depth = 1 if level < 60 else 2
    scored_moves = []
    alpha = float("-inf")
    beta = float("inf")
    for move in list(board.legal_moves):
        board.push(move)
        score = _chess_minimax(board, computer_color, search_depth, alpha, beta)
        board.pop()
        scored_moves.append((score, move.uci()))
        alpha = max(alpha, score)
    if not scored_moves:
        raise ValueError("The computer has no legal chess move")

    best = max(score for score, _ in scored_moves)
    tolerance = (MAX_LEVEL - level) * 5
    candidates = [
        move for score, move in scored_moves if score >= best - tolerance
    ]
    return choice(candidates)


def _chess_minimax(
    board: chess.Board,
    computer_color: chess.Color,
    depth: int,
    alpha: float,
    beta: float,
) -> float:
    outcome = board.outcome(claim_draw=True)
    if outcome is not None:
        if outcome.winner is None:
            return 0
        return 100000 if outcome.winner == computer_color else -100000
    if depth == 0:
        return _evaluate_chess(board, computer_color)

    maximizing = board.turn == computer_color
    best = float("-inf") if maximizing else float("inf")
    for move in board.legal_moves:
        board.push(move)
        value = _chess_minimax(board, computer_color, depth - 1, alpha, beta)
        board.pop()
        if maximizing:
            best = max(best, value)
            alpha = max(alpha, best)
        else:
            best = min(best, value)
            beta = min(beta, best)
        if beta <= alpha:
            break
    return best


def _evaluate_chess(board: chess.Board, computer_color: chess.Color) -> float:
    score = 0
    for piece in board.piece_map().values():
        value = PIECE_VALUES[piece.piece_type]
        score += value if piece.color == computer_color else -value
    if board.is_check():
        score += -25 if board.turn == computer_color else 25
    return score
