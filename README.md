# AusPlay

React (Vite) frontend + FastAPI backend. The current MVP foundation includes account
registration and login, an adult-age confirmation, a game catalogue, and a practice-room
lobby where signed-in users can create rooms, join other players, and play server-validated
Draughts (English checkers), Ludo, or Whot.

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
Whot uses a 75-card deck, deals
five cards, and matches by suit or number. A 1 holds the next player, a 2 or 5 makes the next
player draw two or three and skip, an 8 skips the next player, a 14 makes each opponent draw
one while the player keeps their turn, and WHOT 20 chooses the next suit. Penalty cards do not
stack; when unable to play, a player draws one card and their turn ends. Selecting a playable
game card preselects it in room creation and filters the room list. Game updates are sent as
version-only WebSocket notifications; each player fetches their own private snapshot, with
polling retained while reconnecting. Practice rooms are free-only: the wallet endpoint is
read-only, and deposits, real-money stakes, prizes, and payouts are intentionally not available. Confirm licensing,
launch markets, and compliance requirements with qualified local counsel before enabling any
real-money features.

## Host and moderation workflow
Players can request Host access; an administrator must approve the request before the user can
propose published rulebook text. Approved text changes the public rules description only—the
game engines continue to enforce their built-in rules. Signed-in users can report a room or
player, and administrators can resolve or dismiss reports with a note. Report review does not
automatically suspend accounts or change match outcomes.

To bootstrap an administrator, first create and verify the account, then run
`python -m app.admin_cli USERNAME` from the `backend` directory. This local command promotes
an existing account; there is no public endpoint for granting administrator access.

Signed-in players can choose visible-tab break reminders (30, 60, 90, or 120 minutes, or off).
These reminders are optional and are not a hard play-time limit. Players can dispute a finished
game; administrators review disputes against its recorded result version and add an outcome note.
No identity documents or KYC information are collected. Choose an approved provider and launch
jurisdictions before implementing KYC or any financial features.

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

## Next steps (see the product plan)
1. Select the KYC provider and supported jurisdictions; add age/identity checks only after
   privacy, retention, and compliance review.
2. Only after legal and provider approval, build a tested double-entry wallet, payments,
   stake settlement, and commission flows.
3. Add Alembic migrations before launch.
