from copy import deepcopy
from typing import Any

BOARD_SIZE = 8
EMPTY = "."
RED = "r"
RED_KING = "R"
BLACK = "b"
BLACK_KING = "B"


def initial_state(red_user_id: int, black_user_id: int) -> dict[str, Any]:
    board = [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]
    for y in range(3):
        for x in range(BOARD_SIZE):
            if (x + y) % 2 == 1:
                board[y][x] = BLACK
    for y in range(5, BOARD_SIZE):
        for x in range(BOARD_SIZE):
            if (x + y) % 2 == 1:
                board[y][x] = RED
    return {
        "board": board,
        "red_player_id": red_user_id,
        "black_player_id": black_user_id,
        "turn_user_id": red_user_id,
        "forced_piece": None,
        "status": "active",
        "winner_user_id": None,
    }


def legal_moves(state: dict[str, Any], player_id: int) -> list[dict[str, int | None]]:
    if state["status"] != "active" or state["turn_user_id"] != player_id:
        return []

    side = _side_for_player(state, player_id)
    if side is None:
        return []

    board = state["board"]
    forced_piece = state["forced_piece"]
    pieces = (
        [(forced_piece["x"], forced_piece["y"])]
        if forced_piece is not None
        else [
            (x, y)
            for y, row in enumerate(board)
            for x, piece in enumerate(row)
            if _piece_side(piece) == side
        ]
    )
    captures: list[dict[str, int | None]] = []
    steps: list[dict[str, int | None]] = []
    for x, y in pieces:
        piece_captures, piece_steps = _moves_for_piece(board, x, y)
        captures.extend(piece_captures)
        steps.extend(piece_steps)
    return captures or steps


def apply_move(
    state: dict[str, Any],
    player_id: int,
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
) -> dict[str, Any]:
    move = next(
        (
            candidate
            for candidate in legal_moves(state, player_id)
            if candidate["from_x"] == from_x
            and candidate["from_y"] == from_y
            and candidate["to_x"] == to_x
            and candidate["to_y"] == to_y
        ),
        None,
    )
    if move is None:
        raise ValueError("That move is not legal")

    result = deepcopy(state)
    board = result["board"]
    piece = board[from_y][from_x]
    board[from_y][from_x] = EMPTY
    board[to_y][to_x] = piece
    captured = move["capture_x"] is not None
    if captured:
        assert move["capture_x"] is not None and move["capture_y"] is not None
        board[move["capture_y"]][move["capture_x"]] = EMPTY

    promoted = (piece == RED and to_y == 0) or (piece == BLACK and to_y == BOARD_SIZE - 1)
    if promoted:
        board[to_y][to_x] = RED_KING if piece == RED else BLACK_KING

    opponent_id = (
        result["black_player_id"]
        if player_id == result["red_player_id"]
        else result["red_player_id"]
    )
    if captured and not promoted:
        further_captures, _ = _moves_for_piece(board, to_x, to_y)
        if further_captures:
            result["forced_piece"] = {"x": to_x, "y": to_y}
            return result

    result["forced_piece"] = None
    result["turn_user_id"] = opponent_id
    opponent_side = _opposite(_side_for_player(result, player_id))
    if not any(_piece_side(cell) == opponent_side for row in board for cell in row):
        result["status"] = "finished"
        result["winner_user_id"] = player_id
    elif not _moves_for_side(board, _side_for_player(result, opponent_id)):
        result["status"] = "finished"
        result["winner_user_id"] = player_id
    return result


def _moves_for_piece(
    board: list[list[str]], x: int, y: int
) -> tuple[list[dict[str, int | None]], list[dict[str, int | None]]]:
    piece = board[y][x]
    side = _piece_side(piece)
    if side is None:
        return [], []

    directions = [-1, 1] if piece in (RED_KING, BLACK_KING) else [_forward_direction(side)]
    captures: list[dict[str, int | None]] = []
    steps: list[dict[str, int | None]] = []
    for dy in directions:
        for dx in (-1, 1):
            adjacent_x, adjacent_y = x + dx, y + dy
            target_x, target_y = x + dx * 2, y + dy * 2
            if not _inside(adjacent_x, adjacent_y):
                continue
            if (
                _inside(target_x, target_y)
                and _piece_side(board[adjacent_y][adjacent_x]) == _opposite(side)
                and board[target_y][target_x] == EMPTY
            ):
                captures.append(_move(x, y, target_x, target_y, adjacent_x, adjacent_y))
            elif board[adjacent_y][adjacent_x] == EMPTY:
                steps.append(_move(x, y, adjacent_x, adjacent_y))
    return captures, steps


def _moves_for_side(board: list[list[str]], side: str | None) -> list[dict[str, int | None]]:
    if side is None:
        return []
    captures: list[dict[str, int | None]] = []
    steps: list[dict[str, int | None]] = []
    for y, row in enumerate(board):
        for x, piece in enumerate(row):
            if _piece_side(piece) == side:
                piece_captures, piece_steps = _moves_for_piece(board, x, y)
                captures.extend(piece_captures)
                steps.extend(piece_steps)
    return captures or steps


def _move(
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
    capture_x: int | None = None,
    capture_y: int | None = None,
) -> dict[str, int | None]:
    return {
        "from_x": from_x,
        "from_y": from_y,
        "to_x": to_x,
        "to_y": to_y,
        "capture_x": capture_x,
        "capture_y": capture_y,
    }


def _side_for_player(state: dict[str, Any], player_id: int) -> str | None:
    if player_id == state["red_player_id"]:
        return "red"
    if player_id == state["black_player_id"]:
        return "black"
    return None


def _piece_side(piece: str) -> str | None:
    if piece in (RED, RED_KING):
        return "red"
    if piece in (BLACK, BLACK_KING):
        return "black"
    return None


def _forward_direction(side: str) -> int:
    return -1 if side == "red" else 1


def _opposite(side: str | None) -> str | None:
    if side == "red":
        return "black"
    if side == "black":
        return "red"
    return None


def _inside(x: int, y: int) -> bool:
    return 0 <= x < BOARD_SIZE and 0 <= y < BOARD_SIZE
