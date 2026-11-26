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
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Add these environment variables in the Render service's **Environment** settings:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | The private PostgreSQL connection URL from step 2 |
   | `SECRET_KEY` | Generate a new, long random secret; do not reuse the development key |
   | `CORS_ORIGINS` | `http://localhost:5173` for initial testing; update with the Vercel site URL in step 5 |

   Generate a local secret if needed with
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Add the output only
   to Render's environment settings.
4. Deploy the service and copy its public HTTPS URL, for example
   `https://ausplay-api.onrender.com`.
5. Check `https://<your-render-service>.onrender.com/docs` to confirm the API is
   responding. Do not use the Render dashboard's external database URL if the private
   internal URL is available.

The application creates missing database tables when the backend starts. This is
sufficient for a new database, but `create_all` is not a schema migration system: it
does not update existing tables when models change. Add and run Alembic migrations
before making future schema changes to production data.

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
   | `VITE_API_URL` | The Render backend URL, e.g. `https://ausplay-api.onrender.com` |

   Use the URL origin only: do not add `/docs`, an API path, or a trailing slash.
   `VITE_API_URL` is used at build time, so redeploy after changing it.
4. Deploy and copy the public Vercel URL, for example
   `https://ausplay.vercel.app`.

The frontend derives its WebSocket URL from `VITE_API_URL`, using secure WebSockets
(`wss://`) when the backend URL uses HTTPS. No separate WebSocket URL is needed.

## 5. Allow the Vercel site through backend CORS

In the Render backend's environment settings, set `CORS_ORIGINS` to the exact origin
of the deployed Vercel site, including `https://` and without a trailing slash:

```text
https://ausplay.vercel.app
```

For a custom domain or additional stable frontend origins, list each origin separated
by commas. For example:

```text
https://ausplay.vercel.app,https://play.example.com
```

Save the setting and redeploy/restart the Render service. For local development, the
default remains `http://localhost:5173`. Avoid allowing every origin in production.

## 6. Verify the deployment

1. Open the Vercel URL and confirm the games list loads.
2. Create an account and log in. If API requests fail, check the browser console and
   Render logs, then verify `VITE_API_URL`, `DATABASE_URL`, and `CORS_ORIGINS`.
3. Create and join a practice room with two accounts. Confirm the game updates and room
   chat work in both browser sessions.
4. Confirm Render's service URL is HTTPS and that live room updates connect over WSS.
5. Review Render logs for database connection or startup errors. Never share logs that
   contain secrets.

## Local development

From the repository root, copy `.env.example` to `.env` and set `DATABASE_URL`,
`SECRET_KEY`, and `CORS_ORIGINS`. The frontend uses localhost by default, so no
`VITE_API_URL` is needed locally.

Start the backend from `backend/`:

```powershell
.\.venv\Scripts\activate
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
