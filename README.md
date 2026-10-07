# AI Short Factory Web Pro

> Source of truth: `project.md` + `design.md` (root). Contracts: `docs/`.
> Local-first Web AI Video Automation Factory: React+Vite frontend,
> FastAPI backend, SQLite (Alembic), FFmpeg, Cloud AI BYOK.

## Structure

```text
frontend/  React + TS + Vite + Tailwind (shell + factory UIs, vi text)
backend/   FastAPI /api/v1 + SQLAlchemy + Alembic + SQLite
  app/ai/         Provider registry, adapters, Router, Director prompts
  app/api/v1/     health, diagnostics, ai, story, director, media,
                  jobs, autopilot (runs+scheduler), publisher, affiliate, analytics
  app/engine/     Automation engine (DAG, worker, retry, reuse, recovery)
  app/autopilot/  Auto Pilot runs + scheduler tick
  app/publisher/  Platform adapters (YouTube/TikTok/Facebook/test) + OAuth
  app/media/      Validation, FFmpeg wrapper, pipeline, QC, Production Gate
  app/storage/    Project + affiliate path-jail storage
  app/credentials/ Fernet CredentialStore (secrets never leave server)
  app/ws/         Real-time job event broadcast
docs/      ARCHITECTURE / API_SPEC / DATA_MODEL / SECURITY / ROADMAP
```

## Run (dev)

Backend:

```powershell
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000 --reload-exclude "*/__pycache__/*" --reload-exclude "*.pyc"
```

> `--reload-exclude` keeps bytecode churn from restarting the worker mid-run
> (a restart orphans in-flight autopilot/engine threads; startup recovery
> marks them honestly instead of freezing).

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` (proxies `/api` + `/ws` to `:8000`).

Requires FFmpeg on PATH for render/compose (`ffmpeg: UNAVAILABLE` in
Diagnostics otherwise — renders fail honestly, nothing is faked).

## Checks

```powershell
cd backend; python -m pytest tests
cd ../frontend; npm run typecheck; npm run build; npm test
```

## Honest states (never faked)

* No credential/provider -> `NOT_CONFIGURED` / `MODEL_UNAVAILABLE` / `CREDENTIAL_MISSING`
* Paid without policy -> `PAID_MODEL_BLOCKED` (zero network calls)
* Bad license for commercial -> `LICENSE_BLOCKED` (zero network calls)
* Platforms without OAuth -> `CONFIG_REQUIRED`; publish only on platform confirmation
* No ffmpeg -> `FFMPEG_UNAVAILABLE`; QC/Gate `BLOCKED`; export/publish `422`
* Unknown cost -> `UNKNOWN` (never invented)
* Test doubles are labeled `mock: true` and never count as live verification

## Rules (freeze)

- Typed errors only: `{ code, message, request_id }` (+ `X-Request-Id`).
- No secret in API/log/manifest/provenance/diagnostics/activity/analytics/error/WS.
- `progress_percent` nullable; never fake %.
- Production Gate is server-side and mandatory for export + publish.
- Story and Affiliate factories stay isolated.
