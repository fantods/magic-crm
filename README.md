# Magic CRM

Magic CRM is a CRM whose logical schema emerges from the emails you paste into it. A lead can become a lead record, a support ticket can become a different kind of record, and repeated concepts such as “three clinics,” “six depots,” and “eighteen distribution centres” should fold into one durable `locations_count` column with the values `3`, `6`, and `18`.

This repository is a production-oriented technical demo. It does **not** use Evorozen Neural Pulse; the implementation plan uses PostgreSQL, OpenAI structured outputs, and an append-only schema journal.

## Current status

Milestone 7 is implemented:

- pnpm monorepo
- strict TypeScript
- Fastify API with the versioned `/api/v1` surface (health, ingestion, schema
  catalogue, schema journal, records, natural-language query)
- Vite + React demo UI with the five demo panels: email paste form with example
  buttons, generated schema catalogue, dynamic record grid with expandable
  evidence, append-only journal, and the natural-language query interface
- shared Zod contracts validating every API response in the browser
- PostgreSQL 16 Docker service
- PostgreSQL migrations
- workspace, ingestion, schema journal, schema catalog, and record repositories
- transaction and advisory-lock helpers
- idempotency constraints for ingestions and records
- normalized email model
- architect and reviewer model contracts
- deterministic schema delta calculator
- column synonym folding and source evidence validation
- network-free fake model fixtures
- OpenAI Responses API adapter with structured outputs (server-side only)
- ESLint, Prettier, and Vitest setup

The full architecture and delivery plan is in [`PLAN.md`](./PLAN.md).

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
| Tests           | Vitest                                       |

## Getting started

Requirements:

- Node.js 22+
- pnpm 10
- Docker with Compose

Install dependencies:

```bash
pnpm install
```

Start PostgreSQL:

```bash
pnpm db:up
```

Apply database migrations:

```bash
pnpm db:migrate
```

Start the API in one terminal:

```bash
pnpm dev:api
```

Start the web demo in another:

```bash
pnpm dev:web
```

- API: <http://127.0.0.1:3000/api/v1/health>
- Web: <http://127.0.0.1:5173>

Copy `.env.example` to `.env` to change the API host, port, CORS origin, or web API URL.

### Run the demo

With the API and web app running (`pnpm dev:api`, `pnpm dev:web` after
`pnpm db:up` and `pnpm db:migrate`), open <http://127.0.0.1:5173> and:

1. Click an example email button (or paste your own) and press **Ingest email**.
   Three industry leads fold into one `locations_count` column with the values
   `3`, `6`, and `18`; the support ticket creates a separate `support_tickets`
   table. Watch the generated schema, the record grid with its expandable
   source-phrase evidence, and the append-only journal react.
2. Ask **“Which leads have a budget over 5000?”** in the query panel (the
   example button fills it in) and inspect the interpreted structured query and
   its result.

Live ingestion and query need a server-side `OPENAI_API_KEY` in the API
environment. Without it the UI says so explicitly; the key never reaches the
browser. A full setup guide arrives with milestone 8.

## Quality commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

Database integration tests are skipped by default. Run them against a disposable database with:

```bash
TEST_DATABASE_URL=postgresql://formless:formless@127.0.0.1:5432/formless \
  pnpm --filter @formless/database test
```

Database lifecycle:

```bash
pnpm db:up
pnpm db:down
pnpm db:reset
pnpm db:migrate
pnpm db:migrate:status
```

## Repository layout

```text
apps/
  api/       Fastify HTTP API
  web/       Vite React demo interface
packages/
  contracts/ Shared TypeScript contracts and Zod schemas
  database/  PostgreSQL migrations, repositories, and transaction helpers
  core/       Deterministic ingestion and schema planning logic
  openai/     OpenAI Responses API adapter, structured-output schemas, and prompts
  testing/    Network-free fixtures and fake model implementations
```
