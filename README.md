# Magic CRM

Magic CRM is a CRM whose logical schema emerges from the emails you paste into it. A lead can become a lead record, a support ticket can become a different kind of record, and repeated concepts such as “three clinics,” “six depots,” and “eighteen distribution centres” should fold into one durable `locations_count` column with the values `3`, `6`, and `18`.

This repository is a production-oriented technical demo. It does **not** use Evorozen Neural Pulse; the implementation plan uses PostgreSQL, OpenAI structured outputs, and an append-only schema journal.

## Current status

All eight plan milestones are implemented. The highlights:

- pnpm monorepo with strict TypeScript throughout
- Fastify API with the versioned `/api/v1` surface (health, ingestion, schema
  catalogue, schema journal, records, natural-language query)
- Vite + React demo UI with the five demo panels: email paste form with example
  buttons, generated schema catalogue, dynamic record grid with expandable
  evidence, append-only journal, and the natural-language query interface
- shared Zod contracts validating every API response in the browser
- PostgreSQL 16 Docker service, migrations with verified up/down cycles, and an
  append-only `schema_events` journal guarded by a database trigger
- workspace, ingestion, schema journal, schema catalog, and record repositories
- transaction and advisory-lock helpers; a concurrency stress test proves five
  concurrent writes to one logical table create five records
- idempotency constraints for ingestions and records
- OpenAI Responses API adapter with structured outputs (server-side only),
  exercised through a deterministic fake model in every test and in the e2e run
- production hardening (Milestone 8):
  - security headers (`@fastify/helmet`) with sensible defaults
  - per-IP rate limiting (`@fastify/rate-limit`) with env overrides
  - structured JSON operational logs, including model-call metadata
    (purpose, latency, token counts, request IDs) — never email bodies
  - no-op-by-default error telemetry hooks an operator can wire later
  - an axe-core accessibility audit of the demo UI
  - a Playwright end-to-end walkthrough of the three demo cases with the fake
    model, so it needs no OpenAI key
- ESLint, Prettier, and Vitest setup

The full architecture and delivery plan is in [`PLAN.md`](./PLAN.md); a
step-by-step fresh-clone walkthrough is in
[`docs/local-setup.md`](./docs/local-setup.md), and every acceptance criterion
is mapped to its verification in
[`docs/acceptance-verification.md`](./docs/acceptance-verification.md).

## Stack

| Area            | Choice                                       |
| --------------- | -------------------------------------------- |
| Runtime         | Node.js 22 or newer                          |
| Package manager | pnpm 10                                      |
| Language        | TypeScript, strict mode                      |
| Web             | Vite + React                                 |
| API             | Fastify                                      |
| Database        | PostgreSQL 16                                |
| Validation      | Zod                                          |
| AI              | OpenAI Responses API with structured outputs |
| Tests           | Vitest, Testing Library, Playwright          |

## Getting started (fresh clone)

Requirements:

- Node.js 22+
- pnpm 10
- Docker with Compose

```bash
pnpm install          # install dependencies
pnpm db:up            # start PostgreSQL via Docker Compose
cp .env.example .env  # optional; defaults are sensible
pnpm db:migrate       # apply database migrations
pnpm dev:api          # terminal 1: Fastify API on http://127.0.0.1:3000
pnpm dev:web          # terminal 2: demo UI on http://127.0.0.1:5173
```

- API health: <http://127.0.0.1:3000/api/v1/health>
- Web demo: <http://127.0.0.1:5173>

The `.env` file configures the API host/port, CORS origin, rate limits,
database URL, and the web app's API URL. `OPENAI_API_KEY` is optional: without
a server-side key the demo UI says so explicitly, and with one the same
endpoints run against the real model. The key never reaches the browser.

### Run the demo

With the API and web app running, open <http://127.0.0.1:5173> and:

1. Click an example email button (or paste your own) and press **Ingest email**.
   Three industry leads fold into one `locations_count` column with the values
   `3`, `6`, and `18`; the support ticket creates a separate `support_tickets`
   table. Watch the generated schema, the record grid with its expandable
   source-phrase evidence, and the append-only journal react.
2. Ask **“Which leads have a budget over 5000?”** in the query panel (the
   example button fills it in) and inspect the interpreted structured query and
   its result.

## Tests

Quality commands (no network or database needed for the unit tier):

```bash
pnpm build
pnpm typecheck
pnpm test        # unit + contract + UI tests, network-free
pnpm lint
pnpm format:check
```

PostgreSQL-backed integration tests (concurrency stress, migration up/down
checks, repository and API integration) are skipped unless `TEST_DATABASE_URL`
is set:

```bash
pnpm db:up
pnpm test:integration
```

Playwright end-to-end demo walkthrough (the plan's three demo cases against
the fake model server, no OpenAI key required):

```bash
pnpm db:up
pnpm e2e:install   # one-time: downloads Chromium into ./.browsers
pnpm test:e2e
```

Database lifecycle:

```bash
pnpm db:up
pnpm db:down
pnpm db:reset
pnpm db:migrate
pnpm db:migrate:status
```

## Security and privacy posture

- Parameterized SQL only; queries are validated Zod DSLs compiled to internal
  IDs, executed read-only, with the result limit capped at 200.
- `schema_events` is append-only: a database trigger rejects updates and
  deletes, and application code contains no such statements.
- The OpenAI key is read server-side only; the browser bundle is lint-blocked
  from importing the OpenAI package.
- Email bodies are sent to OpenAI by the server but never written to
  application logs; log fields are constrained to operational metadata.
- Rate limiting and security headers are on by default; overrides are
  documented in `.env.example`.

## Repository layout

```text
apps/
  api/       Fastify HTTP API (+ e2e-server.ts fake-model server)
  web/       Vite React demo interface
e2e/         Playwright demo walkthrough
packages/
  contracts/ Shared TypeScript contracts and Zod schemas
  database/  PostgreSQL migrations, repositories, and transaction helpers
  core/      Deterministic ingestion and schema planning logic
  openai/    OpenAI Responses API adapter, structured-output schemas, and prompts
  testing/   Network-free fixtures and fake model implementations
docs/        Local setup guide and acceptance-criteria verification
```
