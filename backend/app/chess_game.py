from copy import deepcopy
from typing import Any

import chess


def initial_state(white_user_id: int, black_user_id: int) -> dict[str, Any]:
    board = chess.Board()
    return _state(board, white_user_id, black_user_id, [], chess.STARTING_FEN)


def legal_moves(state: dict[str, Any], player_id: int) -> list[dict[str, Any]]:
    if state["status"] != "active":
        return []
    if player_id not in (state["white_player_id"], state["black_player_id"]):
        return []
    if player_id != state["turn_user_id"]:
        return []

    board = _board_from_state(state)
    return [
        {
            "from_x": chess.square_file(move.from_square),
            "from_y": 7 - chess.square_rank(move.from_square),
            "to_x": chess.square_file(move.to_square),
            "to_y": 7 - chess.square_rank(move.to_square),
            "uci": move.uci(),
        }
        for move in board.legal_moves
    ]


def apply_move(
    state: dict[str, Any], player_id: int, move_uci: str
) -> dict[str, Any]:
    legal = next(
        (move for move in legal_moves(state, player_id) if move["uci"] == move_uci),
        None,
    )
    if legal is None:
        raise ValueError("That move is not legal")

    board = _board_from_state(state)
    move = chess.Move.from_uci(move_uci)
    san = board.san(move)
    board.push(move)
    moves = [*state["moves"], {"uci": move_uci, "san": san}]
    return _state(
        board,
        state["white_player_id"],
        state["black_player_id"],
        moves,
        state["initial_fen"],
    )


def _board_from_state(state: dict[str, Any]) -> chess.Board:
    board = chess.Board(state["initial_fen"])
    for played in state["moves"]:
        board.push_uci(played["uci"])
    return board


def _state(
    board: chess.Board,
    white_user_id: int,
    black_user_id: int,
    moves: list[dict[str, str]],
    initial_fen: str,
) -> dict[str, Any]:
    outcome = board.outcome()
    winner_user_id = None
    result = None
    status = "active"
    if outcome is not None:
        status = "finished"
        result = outcome.result()
        if outcome.winner is not None:
            winner_user_id = white_user_id if outcome.winner else black_user_id

    return {
        "fen": board.fen(),
        "initial_fen": initial_fen,
        "board": [
            [
                (piece.symbol() if piece else ".")
                for piece in (board.piece_at(chess.square(x, 7 - y)) for x in range(8))
            ]
            for y in range(8)
        ],
        "white_player_id": white_user_id,
        "black_player_id": black_user_id,
        "turn_user_id": white_user_id if board.turn else black_user_id,
        "status": status,
        "winner_user_id": winner_user_id,
        "result": result,
        "check": board.is_check(),
        "moves": deepcopy(moves),
    }
