const SIZE = 8;
const EMPTY = ".";

export function createSoloDraughtsGame() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if ((x + y) % 2 === 1) board[y][x] = "b";
    }
  }
  for (let y = 5; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if ((x + y) % 2 === 1) board[y][x] = "r";
    }
  }
  return {
    board,
    turn: "player",
    forcedPiece: null,
    status: "active",
    winner: null,
  };
}

export function legalSoloDraughtsMoves(game, side) {
  if (game.status !== "active" || game.turn !== side) return [];
  const pieces = game.forcedPiece
    ? [[game.forcedPiece.x, game.forcedPiece.y]]
    : game.board.flatMap((row, y) => row.flatMap((piece, x) => (
      pieceSide(piece) === side ? [[x, y]] : []
    )));
  const captures = [];
  const steps = [];
  for (const [x, y] of pieces) {
    const pieceMoves = movesForPiece(game.board, x, y);
    captures.push(...pieceMoves.captures);
    steps.push(...pieceMoves.steps);
  }
  return captures.length ? captures : steps;
}

export function applySoloDraughtsMove(game, side, move) {
  const legalMove = legalSoloDraughtsMoves(game, side).find((candidate) => (
    candidate.from_x === move.from_x
    && candidate.from_y === move.from_y
    && candidate.to_x === move.to_x
    && candidate.to_y === move.to_y
  ));
  if (!legalMove) throw new Error("That move is not legal");

  const board = game.board.map((row) => [...row]);
  const piece = board[legalMove.from_y][legalMove.from_x];
  board[legalMove.from_y][legalMove.from_x] = EMPTY;
  board[legalMove.to_y][legalMove.to_x] = piece;
  const captured = legalMove.capture_x !== null;
  if (captured) board[legalMove.capture_y][legalMove.capture_x] = EMPTY;

  const promoted = (piece === "r" && legalMove.to_y === 0)
    || (piece === "b" && legalMove.to_y === SIZE - 1);
  if (promoted) board[legalMove.to_y][legalMove.to_x] = piece.toUpperCase();

  const result = {
    ...game,
    board,
    forcedPiece: null,
  };
  if (captured && !promoted && movesForPiece(board, legalMove.to_x, legalMove.to_y).captures.length) {
    result.forcedPiece = { x: legalMove.to_x, y: legalMove.to_y };
    return result;
  }

  const opponent = side === "player" ? "system" : "player";
  result.turn = opponent;
  const opponentPiecesRemain = board.some((row) => row.some((cell) => pieceSide(cell) === opponent));
  if (!opponentPiecesRemain || !movesForSide(board, opponent).length) {
    result.status = "finished";
    result.winner = side;
  }
  return result;
}

export function chooseComputerMove(game, requestedLevel) {
  const moves = legalSoloDraughtsMoves(game, "system");
  if (!moves.length) return null;
  const level = Math.max(1, Math.min(100, Math.trunc(requestedLevel)));
  if (level === 1) return moves[Math.floor(Math.random() * moves.length)];

  const depth = Math.ceil(level / 20);
  const scoredMoves = moves.map((move) => {
    const next = applySoloDraughtsMove(game, "system", move);
    const remainingDepth = depth - (next.turn === game.turn ? 0 : 1);
    return {
      move,
      score: minimax(next, remainingDepth, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    };
  });
  const bestScore = Math.max(...scoredMoves.map((candidate) => candidate.score));
  const tolerance = (100 - level) * 1.5;
  const acceptableMoves = scoredMoves.filter((candidate) => candidate.score >= bestScore - tolerance);
  return acceptableMoves[Math.floor(Math.random() * acceptableMoves.length)].move;
}

function minimax(game, depth, alpha, beta) {
  if (game.status === "finished") {
    return game.winner === "system" ? 100000 + depth : -100000 - depth;
  }
  if (depth <= 0 && !game.forcedPiece) return evaluateBoard(game.board);

  const side = game.turn;
  const moves = legalSoloDraughtsMoves(game, side);
  if (!moves.length) return side === "system" ? -100000 : 100000;
  const maximizing = side === "system";
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const move of moves) {
    const next = applySoloDraughtsMove(game, side, move);
    const remainingDepth = depth - (next.turn === side ? 0 : 1);
    const score = minimax(next, remainingDepth, alpha, beta);
    if (maximizing) {
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
    } else {
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }
  return bestScore;
}

function evaluateBoard(board) {
  let score = 0;
  board.forEach((row, y) => row.forEach((piece, x) => {
    const side = pieceSide(piece);
    if (!side) return;
    const sign = side === "system" ? 1 : -1;
    const king = piece === "R" || piece === "B";
    const advancement = side === "system" ? y : SIZE - 1 - y;
    const center = 3.5 - Math.abs(3.5 - x) + 3.5 - Math.abs(3.5 - y);
    score += sign * ((king ? 180 : 100) + advancement * 3 + center * (king ? 3 : 1));
  }));
  return score;
}

function movesForSide(board, side) {
  const captures = [];
  const steps = [];
  board.forEach((row, y) => row.forEach((piece, x) => {
    if (pieceSide(piece) !== side) return;
    const pieceMoves = movesForPiece(board, x, y);
    captures.push(...pieceMoves.captures);
    steps.push(...pieceMoves.steps);
  }));
  return captures.length ? captures : steps;
}

function movesForPiece(board, x, y) {
  const piece = board[y][x];
  const side = pieceSide(piece);
  if (!side) return { captures: [], steps: [] };
  const directions = piece === "R" || piece === "B"
    ? [-1, 1]
    : [side === "player" ? -1 : 1];
  const captures = [];
  const steps = [];
  for (const dy of directions) {
    for (const dx of [-1, 1]) {
      const adjacentX = x + dx;
      const adjacentY = y + dy;
      const targetX = x + dx * 2;
      const targetY = y + dy * 2;
      if (!inside(adjacentX, adjacentY)) continue;
      if (
        inside(targetX, targetY)
        && pieceSide(board[adjacentY][adjacentX]) === opposite(side)
        && board[targetY][targetX] === EMPTY
      ) {
        captures.push(makeMove(x, y, targetX, targetY, adjacentX, adjacentY));
      } else if (board[adjacentY][adjacentX] === EMPTY) {
        steps.push(makeMove(x, y, adjacentX, adjacentY));
      }
    }
  }
  return { captures, steps };
}

function makeMove(from_x, from_y, to_x, to_y, capture_x = null, capture_y = null) {
  return { from_x, from_y, to_x, to_y, capture_x, capture_y };
}

function pieceSide(piece) {
  if (piece === "r" || piece === "R") return "player";
  if (piece === "b" || piece === "B") return "system";
  return null;
}

function opposite(side) {
  return side === "player" ? "system" : "player";
}

function inside(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}
