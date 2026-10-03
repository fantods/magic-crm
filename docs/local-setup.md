# Local setup guide

Everything needed to take a fresh clone to a running demo, and to run every
test tier. All commands run from the repository root.

## 0. Prerequisites

- **Node.js 22 or newer** — `node --version`
- **pnpm 10** — `pnpm --version` (enable with `corepack enable` if needed)
- **Docker with Compose** — `docker compose version`

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start PostgreSQL

```bash
pnpm db:up
```

This starts the `postgres:16-alpine` service from `docker-compose.yml` (user
`formless`, password `formless`, database `formless` on `127.0.0.1:5432`) and
waits until it is healthy. Stop it later with `pnpm db:down`; wipe the volume
with `pnpm db:reset`.

## 3. Configure the environment (optional)

```bash
cp .env.example .env
```

Defaults work out of the box. The knobs:

| Variable                    | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `PORT` / `HOST`             | API bind address (default `127.0.0.1:3000`)                     |
| `CORS_ORIGIN`               | Browser origin the API allows (default the Vite dev URL)        |
| `RATE_LIMIT_ENABLED`        | `false` disables the per-IP limiter                             |
| `RATE_LIMIT_MAX`            | Requests per IP inside the window (default 300)                 |
| `RATE_LIMIT_TIME_WINDOW_MS` | Rate-limit window (default 60000)                               |
| `DATABASE_URL`              | PostgreSQL connection string                                    |
| `OPENAI_API_KEY`            | Server-side only; enables live ingestion/query                  |
| `OPENAI_MODEL`              | Defaults to `gpt-5.1`                                           |
| `VITE_API_URL`              | The web app's API base (default `http://localhost:3000/api/v1`) |

Without `OPENAI_API_KEY` the demo runs read-only paths and the UI explains
what is missing; the key is never exposed to the browser.

## 4. Apply migrations

```bash
pnpm db:migrate
```

Verify with `pnpm db:migrate:status`. Undo the latest migration with
`pnpm db:migrate:down`. The migrator's up/down cycles are verified by
`packages/database/src/migrator.integration.test.ts`.

## 5. Run the app

Two terminals:

```bash
pnpm dev:api   # Fastify API on http://127.0.0.1:3000 (JSON logs on stdout)
pnpm dev:web   # Vite demo UI on http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>, click an example email button, and press
**Ingest email**. Three industry leads fold into one `locations_count` column
with values 3, 6, and 18; the support ticket creates its own
`support_tickets` table. Then run the example question
**“Which leads have a budget over 5000?”** in the query panel.

## 6. Run the tests

```bash
pnpm build         # compile all workspace packages
pnpm typecheck     # strict TypeScript, project references
pnpm test          # unit + contract + UI tests (network-free)
pnpm lint          # ESLint
pnpm format:check  # Prettier
```

PostgreSQL-backed integration tests (migration up/down checks, repositories,
ingestion/query API, concurrency stress) skip unless `TEST_DATABASE_URL` is
set. With the Docker database from step 2 running:

```bash
pnpm test:integration
```

which is equivalent to:

```bash
TEST_DATABASE_URL=postgresql://formless:formless@127.0.0.1:5432/formless pnpm -r test
```

## 7. Run the end-to-end demo walkthrough

The Playwright suite starts its own API server (wired to the deterministic
fake model, so no OpenAI key is needed) and its own Vite server, then walks
the plan's three demo cases in a real Chromium browser:

```bash
pnpm db:up
pnpm e2e:install   # one-time: downloads Chromium into ./.browsers
pnpm test:e2e
```

The e2e API server uses the dedicated `formless_e2e` database (creating it if
needed) and resets it on every boot, so the walkthrough is always
deterministic. Override with `E2E_DATABASE_URL`; the server refuses to start
against a database whose name does not contain `e2e`.

Reports and traces land in `test-results/` on failure.

## 8. Troubleshooting

- **`database "formless" does not exist`** — run `pnpm db:up` first; the
  Docker service creates it.
- **Port already in use** — change `PORT` (API) in `.env`, or the Vite port
  via `pnpm --filter @formless/web exec vite --port 5174`.
- **Migrations out of sync after pulling schema changes** — `pnpm db:migrate`
  applies only what is missing; `pnpm db:reset` wipes the volume for a clean
  slate (then `pnpm db:up && pnpm db:migrate`).
- **503 on ingest/query** — no server-side `OPENAI_API_KEY`; see step 3. The
  fake-model e2e tier always works without a key.
