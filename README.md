# AusPlay

React (Vite) frontend + FastAPI backend. The current MVP foundation includes account
registration and login, an adult-age confirmation, a game catalogue, and a practice-room
lobby where signed-in users can create rooms, join other players, and play server-validated
Draughts (English checkers), Chess, Ludo, or Whot, and scorecard simulations for Golf,
Polo, or Snooker. Each signed-in player can view a private profile with completed match
history, per-game results, win rate, and solo Draughts progress. Signed-in users can also
play all seven games against the computer. Chess, Ludo, Whot, Golf, Polo, and Snooker each
have independent 100-level progression saved to the account; wins unlock the next level.
Computer opponents make server-side moves in the board and card games, while Golf, Polo,
and Snooker generate level-based scorecards. Draughts retains its existing solo mode.
Chess supports standard legal moves, checkmate, castling, en passant, and promotion. Golf is
played in 2-4 player, nine-hole scorecard matches; players enter their completed strokes in
turn, and the lowest total wins. Polo is a two-player, four-chukka scorecard match; each
player represents a team and enters goals in turn. Snooker is a two-player,
best-of-three frame scorecard; players enter their frame points in turn, and the first to
two frame wins takes the match. These scorecard games use self-reported scores for friendly
practice.

For production deployment, follow [DEPLOYMENT.md](./DEPLOYMENT.md).

The first game uses forward-moving men, short kings, mandatory captures, and continuation
of multiple jumps with the same piece. Ludo supports 2-4 players, four tokens per player,
six to leave base and earn another roll, safe squares, blockades, captures, and exact rolls
to finish. Captures do not earn another roll and there is no three-sixes penalty. Ludo dice use
a committed server seed and a client seed generated for each roll; the server seed is revealed
after the match, and the UI can verify the commitment and recorded rolls. Each client seed is
32 cryptographically random bytes; the nonce is the game version before the roll. The game
derives a big-endian HMAC-SHA256 value from `client_seed:nonce:attempt`, rejection-samples it
without modulo bias, and maps the accepted value to 1-6.
Chess uses standard chess rules; the server validates every move and records the match.
Golf uses a fixed nine-hole course (par 36), with server-enforced turn order and stroke
limits. Scores are entered by players and are not independently verified.
Polo uses four chukkas, with team goals entered by players in turn; ties are supported and
scores are not independently verified.
Snooker uses a best-of-three frame scorecard; players enter break points for each frame,
and the first to two frame wins takes the match. Frame and match ties are supported.
These scorecard scores are not independently verified.
Whot uses a 75-card deck, deals
five cards, and matches by suit or number. A 1 holds the next player, a 2 or 5 makes the next
player draw two or three and skip, an 8 skips the next player, a 14 makes each opponent draw
one while the player keeps their turn, and WHOT 20 chooses the next suit. Penalty cards do not
stack; when unable to play, a player draws one card and their turn ends. Selecting a playable
game card preselects it in room creation and filters the room list. Game updates are sent as
version-only WebSocket notifications; each player fetches their own private snapshot, with
polling retained while reconnecting. Practice rooms can be free or use an optional equal
per-player NGN stake selected by the room creator. The stake is displayed before joining and
escrowed only when the room fills and its game starts. A sole winner receives the pot less 10%
of losing stakes; a tie refunds each player's stake. Financial matches settle immediately when
the game engine records a result. A later dispute does not reverse a completed payment.

The Virtual Games section presents outcomes from completed AusPlay matches in 60-second
prediction rounds. Player labels are anonymous, and the stored result is revealed only after
the round closes. A real-money round is available only after at least 10 completed matches for
the same game and player count. If there is not enough history, a clearly labeled demo round is
shown; demo rounds are generated for illustration, allow free picks with no NGN stakes or payouts,
and are not counted as real match history. Existing demo records are removed when eligible real match history becomes
available, and real results are recycled rather than replaced with more demos. Predictors share
the losing stakes proportionally, with 10% of losing stakes
retained as commission. If no predictor selected the result, all stakes are refunded. These are
historical simulations, not live matches.
Some games use player-entered scorecards; those scores are not independently verified, so
completed-match history must not be presented as externally verified results.

Wallet balances are held in integer kobo. New accounts start at NGN 0; there is no automatic
NGN 5,000 grant. Players can fund wallets through Paystack checkout, and only an administrator
can issue manual top-ups after verifying the funding outside the application. Top-ups are recorded
with an audit reference and reason. Paystack deposits are credited only after server-side
transaction verification or a signed webhook, with the amount and currency checked against the
pending deposit. The Paystack secret must be configured on the backend, and the Paystack webhook
must point to `/payments/paystack/webhook`. Keep deposits and withdrawals disabled until the
Paystack account, webhook, and supported jurisdiction are configured and verified.

These features handle money and are not a substitute for legal, payment-provider, age, KYC,
consumer-protection, or responsible-play review. Do not launch them to users until the required
approvals, controls, and operational procedures are in place.

## Host and moderation workflow
Players can request Host access; an administrator must approve the request before the user can
propose published rulebook text. Approved text changes the public rules description only—the
game engines continue to enforce their built-in rules. Signed-in users can report a room or
player, and administrators can resolve or dismiss reports with a note. Report review does not
automatically suspend accounts or change match outcomes.

To bootstrap an administrator, first create and verify the account, then run
`alembic upgrade head` followed by `python -m app.admin_cli USERNAME` from the `backend`
directory. This local command promotes an existing account; there is no public endpoint
for granting administrator access.

Signed-in players can choose visible-tab break reminders (30, 60, 90, or 120 minutes, or off).
These reminders are optional and are not a hard play-time limit. Players can dispute a finished
game; administrators review disputes against its recorded result version and add an outcome note.
No identity documents or KYC information are collected. Choose an approved provider and launch
jurisdictions before making financial features available.

## Run the backend
The backend reads `DATABASE_URL` from the project-root `.env` file. Copy `.env.example`
to `.env` and set your database URL; if it is not set, the backend uses the local SQLite
database.

```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows   (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
set SECRET_KEY=change-me      # Mac/Linux: export SECRET_KEY=change-me
set PAYSTACK_SECRET_KEY=      # Configure only on the backend when withdrawals are enabled
alembic upgrade head
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs

## Run the frontend
```
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

Database schema changes are managed with Alembic. See [DEPLOYMENT.md](./DEPLOYMENT.md)
for initial setup, existing-database adoption, and the migration workflow.
