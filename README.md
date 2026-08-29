# VacationPlanner

A gamified, Elo-based duel tournament for deciding where to go (and what to do) on a trip.
Enter all the places (and activities) you've been considering and invite your friends, the game will handle all
the rest and research place descritions, recommended visit length and images representing them.

Two places face off, you pick your favorite, and over enough rounds a ranking emerges —
with an automatic cutoff line showing what actually fits in your trip's schedule.

## Stack

- **Frontend**: Angular 22 (standalone components) + Angular Material, served via nginx
- **Backend**: Node.js/Express + TypeScript
- **Database**: PostgreSQL
- **Local LLM**: [Ollama](https://ollama.com), run natively on the host, running
  `qwen2.5:7b-instruct`, used to research how long each place/activity takes
- **Web search for the LLM**: a self-hosted [SearxNG](https://docs.searxng.org/) instance (no API
  keys, no external service accounts needed). The backend runs the search itself and hands the
  LLM the resulting snippets in a single prompt — see [Why not an agentic tool-calling loop?](#why-not-an-agentic-tool-calling-loop)
- **Photos**: best-effort, key-free image lookup via DuckDuckGo's image search, scored by
  relevance and how close the image's aspect ratio is to the card format

Everything runs from a single `docker-compose.yml` — no cloud accounts or API keys required.

## Prerequisites

- Docker and Docker Compose (Docker Desktop on Mac/Windows, or Docker Engine + the `compose`
  plugin on Linux)
- [Ollama](https://ollama.com) installed **natively on the host** (not in Docker — see
  [Why not an agentic tool-calling loop?](#why-not-an-agentic-tool-calling-loop) for why), with the
  model pulled once:
  ```bash
  ollama pull qwen2.5:7b-instruct
  ```
- ~4GB of free RAM for Postgres/SearxNG/backend, plus whatever Ollama needs for the model above

## Running it

```bash
ollama serve          # if it isn't already running as a background service
docker compose up --build
```

Then open **http://localhost:4200**.

First run notes:
- If Ollama isn't reachable at `http://host.docker.internal:11434` when a vacation is created,
  place-time research silently falls back to a default 2-hour estimate for that run rather than
  failing. Photo lookup is independent of Ollama and works as soon as SearxNG/DuckDuckGo are
  reachable.

### Ports

| Service    | Port  | Runs in       |
|------------|-------|---------------|
| Frontend   | 4200  | Docker        |
| Backend API| 3000  | Docker        |
| Postgres   | 5432  | Docker        |
| SearxNG    | 8080  | Docker        |
| Ollama     | 11434 | Host (native) |

## Using the app

1. Pick or create a vacation.
2. When creating a vacation, list your places (one per line, or upload a `.txt` file), and set
   trip duration, active hours/day, and average travel time between places. Creation kicks off a
   background job that researches each place's visit duration and fetches a photo — a progress bar
   with an ETA is shown while that runs.
3. Identify yourself (or pick your name if you've already played this vacation).
4. From all the categories the places fit into, distribute percentages to show how important each category is for this trip. (note: every player will do this, the median percentage will count)
5. Duel: two places at a time, pick your favorite. Every place shows up at least once before the pool
   resets for a new round. Elo ratings are shared across everyone planning the same vacation.
6. Hit "Ranking" any time to see the combined results, with a cutoff line marking where your
   itinerary's time budget runs out.

## Configuration

All configuration lives in `docker-compose.yml` as environment variables on the `backend` service:

- `OLLAMA_MODEL` — swap for a different plain **instruct** model if you like (e.g.
  `qwen2.5:3b-instruct` for something lighter, `llama3.1:8b-instruct` for something larger). Avoid
  hybrid-reasoning models (Qwen3's default tags, DeepSeek-R1, etc.) — see below.
- `OLLAMA_CHAT_TIMEOUT_MS` — how long the single research chat call may take before giving up and
  falling back to a default 2-hour estimate.
- `PHOTO_CONCURRENCY` — how many places' photo lookups run in parallel during vacation creation
  (IO-bound, safe to raise).
- `LLM_CONCURRENCY` — how many LLM research calls run in parallel. Keep this at `1` unless you know
  your Ollama setup can genuinely serve concurrent requests fast (e.g. a strong GPU) — running
  multiple inference calls at once just makes each one slower.

## Local development (without Docker)

Requires Node.js 22.22+ (or 24+) for the frontend, and a running Postgres + SearxNG + Ollama
reachable at the URLs referenced below.

```bash
# Backend
cd backend
npm install
DATABASE_URL=postgres://vacation:vacation@localhost:5432/vacation_planner \
SEARXNG_URL=http://localhost:8080 \
OLLAMA_URL=http://localhost:11434 \
OLLAMA_MODEL=qwen2.5:7b-instruct \
npm run dev

# Frontend (in another shell)
cd frontend
npm install
npm start   # proxies /api to localhost:3000 via proxy.conf.json
```

## Notes & known limitations

- Photo and web search rely on scraping public, key-free endpoints (DuckDuckGo images, SearxNG).
  This keeps the app fully self-contained with no accounts to manage, but is inherently less
  reliable than a paid search API — occasional missing photos or thin research are expected and
  handled gracefully (placeholder image, fallback duration estimate).
- This app is intended for internal/personal use — there's no authentication; anyone who knows a
  vacation exists can join it and add themselves as a player. There is the possibility of adding a password to your vacation though.
- SearxNG may log `ERROR:searx.botdetection: X-Forwarded-For nor X-Real-IP header is set!` — this
  is expected since the backend talks to it directly with no reverse proxy in front, and is
  harmless (`limiter: false` in `searxng/settings.yml` disables bot-detection/rate-limiting
  entirely, so it doesn't block anything). If you ever put SearxNG behind a reverse proxy, that
  proxy should set `X-Real-IP` for this warning to go away.
