# Deploy AusPlay

AusPlay is a monorepo with two separate deployable projects:

- `backend/` contains the FastAPI application and `requirements.txt`.
- `frontend/` contains the Vite/React application and `package.json`.

Deploy the backend to Render and the frontend to Vercel as separate services from the
same Git repository. The frontend calls the backend using `VITE_API_URL`; the backend
uses `DATABASE_URL` and `CORS_ORIGINS`.

## 1. Prepare the repository

1. Push the project to a Git provider supported by Render and Vercel.
2. Keep the root `.env` file out of Git. `.gitignore` ignores `.env` and other local
   environment files; `.env.example` contains placeholders only.
3. Do not put database credentials, signing keys, or other secrets in source files or
   any `VITE_` variable. Vite variables are included in browser code.

The local root `.env` is loaded by the backend for development. For hosted services,
enter environment values in the Render and Vercel dashboards instead of uploading the
local `.env` file.

## 2. Create the PostgreSQL database on Render

1. In Render, create a PostgreSQL database. Choose a region that you will also use for
   the backend web service.
2. Once it is ready, copy its **Internal Database URL** from the database's connection
   details. Use the internal URL when the database and backend are in the same Render
   region; keep it private.
3. If you already have a database, use its connection URL instead. Do not paste database
   credentials into this document or commit them to the repository.

## 3. Deploy the FastAPI backend to Render

1. Create a **Web Service** and connect the repository.
2. Configure the service:
   - **Root Directory:** `backend`
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Add these environment variables in the Render service's **Environment** settings:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | The private PostgreSQL connection URL from step 2 |
   | `SECRET_KEY` | Generate a new, long random secret; do not reuse the development key |
   | `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` for initial testing; update with the Vercel site URL in step 5 |
   | `AUTH_COOKIE_SECURE` | `true` for the deployed HTTPS service |
   | `FRONTEND_URL` | The deployed frontend origin, such as `https://ausplay.vercel.app` |
   | `SMTP_HOST` | Hostname of your SMTP email provider |
   | `SMTP_PORT` | Provider SMTP port, commonly `587` or `465` |
   | `SMTP_USERNAME` | SMTP username, if required by the provider |
   | `SMTP_PASSWORD` | SMTP password or provider app password; configure only in Render |
   | `SMTP_FROM_EMAIL` | Verified sender address for AusPlay email |

   Generate a local secret if needed with
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Add the output only
   to Render's environment settings.
4. Deploy the service and use its public HTTPS URL:
   `https://ausplay.onrender.com`.
5. Open `https://ausplay.onrender.com/` for the API status response and
   `https://ausplay.onrender.com/docs` for the interactive API documentation. Do not
   use the Render dashboard's external database URL if the private internal URL is
   available.

The Render URL hosts the FastAPI backend, not the React website. The frontend is served
separately by Vercel and uses this backend URL for API and WebSocket requests.

The backend applies Alembic migrations before starting. For a multi-instance service,
run `alembic upgrade head` once as a pre-deploy/release command rather than from every
instance's start command.

### Database migrations

Run Alembic commands from `backend/`; it reads `DATABASE_URL` from the root `.env`
locally and from the service environment in production. Never put a database password
in `alembic.ini` or commit it to the repository.

Before deploying the new start command to a database previously managed by
`create_all`, complete the existing-database adoption steps below. Otherwise, the
initial migration will try to create tables that already exist and the service will
not start.

For a new, empty database, apply the current schema:

```powershell
alembic upgrade head
alembic current
```

For the first deployment to a database that already has tables from the old
`create_all` startup behavior:

1. Back up the database and stop writes during the transition.
   If the database already has an Alembic revision marker, do not stamp it; inspect
   `alembic current` and apply pending migrations with `alembic upgrade head`.
2. Verify the backup or a staging clone against the initial migration. On the clone,
   set `DATABASE_URL` using a secure environment setting (or use a Render shell), then
   run:

   ```powershell
   alembic stamp 7f2aa7ab65c2
   alembic upgrade head
   alembic check
   ```

   The initial revision ID is `7f2aa7ab65c2`. Stamp that baseline, not `head`, so
   migrations added later are still applied. Continue only if `alembic check` reports
   no schema changes after upgrading the clone.
3. If the clone matches, record the baseline on the production database without
   recreating tables, then apply all later migrations:

   ```powershell
   alembic stamp 7f2aa7ab65c2
   alembic upgrade head
   alembic current
   ```

   `stamp` changes only Alembic's version marker; it does not create, alter, or validate
   tables. Do not stamp a database with missing or different columns. Reconcile such a
   schema deliberately, test it on a copy, and verify it before proceeding.

If the backend log reports that `solo_game_sessions` or `solo_game_progress` does not
exist, the web service is using a database where the solo-games migration has not been
applied. From the backend directory in the same deployment environment and with the
same `DATABASE_URL` as the web service, run:

```powershell
alembic current
alembic heads
alembic upgrade head
alembic current
```

The current revision should match the single head printed by `alembic heads`. Render's
start command also runs `alembic upgrade head` before Uvicorn; confirm it is still set to
`alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT` and check the
deploy logs for migration errors. If Alembic reports the database is already at head but
the table is still absent, back up the database and verify that the web service and
migration command use the same `DATABASE_URL`. The revision marker may have been stamped
incorrectly; verify the actual schema on a clone and only then reconcile the marker and
apply migrations. Do not use `stamp head` to work around a missing table; stamping marks
migrations as applied without creating their tables.

If `alembic upgrade head` fails with `DuplicateTable: relation "users" already exists`,
the database has existing tables but Alembic is trying to run the initial schema
migration. Do not retry `upgrade head` or create a new revision yet. After taking a
backup, check `alembic current`:

- If it shows no revision and this is the legacy database created by the application's
  former `create_all` startup, verify on a backup or staging clone that its existing
  schema matches the initial revision. If it does, baseline that existing schema and
  apply later migrations:

  ```powershell
  alembic stamp 7f2aa7ab65c2
  alembic upgrade head
  alembic current
  alembic check
  ```

- If it reports `7f2aa7ab65c2`, run `alembic upgrade head` to apply pending migrations.
- If it reports another revision, or the schema does not match the initial migration,
  stop and reconcile the database on a clone first. Do not stamp an unverified schema.

`Target database is not up to date` from `alembic revision --autogenerate` means pending
migrations must be applied before generating another revision. That command creates a
new migration; it is not part of repairing the database's migration history.

If Render exits with `alembic: command not found`, Alembic was not installed in the
deployed environment. Confirm `alembic` is listed in `backend/requirements.txt`, that
the Render service uses `backend` as its root directory and runs
`pip install -r requirements.txt`, and that the requirements and migration files have
been committed and pushed to the branch Render deploys. A package installed only in a
local virtual environment is not available to Render. Redeploy after pushing the
dependency change and confirm the build log installs Alembic before the start command
runs.

For each later schema change, edit the SQLAlchemy models, then create and review a
migration:

```powershell
alembic revision --autogenerate -m "describe the schema change"
alembic upgrade head
alembic current
```

Autogeneration is a draft: review the generated file, especially renames, data
backfills, and destructive changes. Add explicit data migration steps when needed.
Test upgrades against a disposable database before production. Back up production
before applying changes. `alembic downgrade -1` can reverse a revision only when its
downgrade is safe; it is not a substitute for restoring a database backup.

Changing `DATABASE_URL` points the app and Alembic at a different database; migrations
create the schema there but do not copy user or game data. For a database move, back up
and restore or migrate the data separately, verify the restored schema, then use
`alembic current` (or carefully `alembic stamp head` if the restored schema is exactly
at the current revision). Test the full move on a non-production copy first.
Run `alembic upgrade head` on a new, empty destination; do not use `stamp` there.

## 4. Deploy the Vite frontend to Vercel

1. Create a Vercel project and import the same repository.
2. Configure the project:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (usually detected automatically)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
3. Add this environment variable to the Vercel project:

   | Key | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://ausplay.onrender.com` |

   Use the URL origin only: do not add `/docs`, an API path, or a trailing slash.
   `VITE_API_URL` is used at build time, so redeploy after changing it.
4. Deploy and copy the public Vercel URL, for example
   `https://ausplay.vercel.app/`.

The frontend derives its WebSocket URL from `VITE_API_URL`, using secure WebSockets
(`wss://`) when the backend URL uses HTTPS. No separate WebSocket URL is needed.
If `VITE_API_URL` is not set for a production build, the frontend defaults to
`https://ausplay.onrender.com`. Local development continues to default to
`http://localhost:8000`.

## 5. Allow the Vercel site through backend CORS

In the Render backend's environment settings, set `CORS_ORIGINS` to the exact origin
of the deployed Vercel site, including `https://` and without a trailing slash:

```text
https://ausplay.vercel.app
```

For a custom domain or additional stable frontend origins, list each origin separated
by commas. Include the exact scheme, hostname, and port used by the browser; `localhost`
and `127.0.0.1` are different origins. For example:

```text
https://ausplay.vercel.app,https://play.example.com
```

Save the setting and redeploy/restart the Render service. For local development, the
default remains `http://localhost:5173`. Avoid allowing every origin in production.
For local development on either hostname, set
`CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173` in the root `.env`.
If an `OPTIONS` request returns 400, check the browser's Network panel for the request's
`Origin` and include that exact origin (including its port) in `CORS_ORIGINS`; restart
the backend after changing the local `.env`.

Authentication is restored from an HttpOnly session cookie when the page loads. The
cookie lasts 12 hours, is `Secure` and `SameSite=None` in production, and is cleared by
the **Log out** action. Credentialed CORS must use the exact frontend origin above; the
backend also checks request origins for cookie-authenticated changes. After deploying
this update, log in once again so the backend can issue the cookie, then verify that a
page refresh keeps you signed in. If the browser blocks third-party cookies between the
Vercel and Render domains, use a custom frontend/API domain under the same site or enable
third-party cookies for the site.

## 6. Player profiles and account recovery

SMTP is optional for account registration and login. Display name and email are optional
at signup; accounts are created even when email delivery is unavailable. Configure the
SMTP variables above to send email verification and password-recovery links. Players can
add an email and display name in their private profile and verify the address before
using password recovery. Recovery links are single-use and expire after 30 minutes.
Password reset invalidates existing login sessions.

Other players can open public profiles from player names in rooms and game boards.
Public profiles include display name, username, match statistics, and recent match
history; email addresses are never included in public profile responses. Account owners
can see their own email and verification status. Keep SMTP credentials in Render
environment settings and never commit them.

## 7. Verify the deployment

1. Open the Vercel URL and confirm the games list loads.
2. Create an account and log in. If API requests fail, check the browser console and
   Render logs, then verify `VITE_API_URL`, `DATABASE_URL`, and `CORS_ORIGINS`.
3. Open **Profile** and confirm the account shows its completed-match totals and private
   history. After playing a completed match, confirm the result and opponent appear.
4. Create and join a practice room with two accounts. Confirm the game updates and room
   chat work in both browser sessions. For Chess, verify turns alternate and illegal moves
   are rejected. For Golf, verify each player enters a score in turn and the match ends
   after nine holes. For Polo, verify team scores are entered in turn and the match ends
   after four chukkas. For Snooker, verify frame scores alternate and the first player to
   two frame wins finishes the match.
5. Sign in and start solo Chess, Ludo, Whot, Golf, Polo, and Snooker. Confirm each computer
   takes its turn or submits a scorecard, that a win unlocks the next level for that game
   only, and that the current solo game survives a page refresh.
6. Confirm Render's service URL is HTTPS and that live room updates connect over WSS.
7. Review Render logs for database connection or startup errors. Never share logs that
   contain secrets.

## Local development

From the repository root, copy `.env.example` to `.env` and set `DATABASE_URL`,
`SECRET_KEY`, and `CORS_ORIGINS`. The frontend uses localhost by default, so no
`VITE_API_URL` is needed locally.

Start the backend from `backend/`:

```powershell
.\.venv\Scripts\activate
alembic upgrade head
uvicorn app.main:app --reload
```

Start the frontend from `frontend/`:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

## Hosting notes

- Keep the Render database and backend in the same region where possible.
- A sleeping/free web service may take time to wake and can interrupt WebSocket
  connections. The client reconnects, but use an always-on service for reliable live
  matches.
- Back up the PostgreSQL database and restrict access to its connection URL.
- Before production launch, use migrations, configure backups/monitoring, and review
  authentication, moderation, privacy, and applicable compliance requirements.
