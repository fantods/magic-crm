# Magic CRM

Magic CRM is a CRM whose logical schema emerges from the emails you paste into it. A lead can become a lead record, a support ticket can become a different kind of record, and repeated concepts such as “three clinics,” “six depots,” and “eighteen distribution centres” should fold into one durable `locations_count` column with the values `3`, `6`, and `18`.

This repository is a production-oriented technical demo. It does **not** use Evorozen Neural Pulse; the implementation plan uses PostgreSQL, OpenAI structured outputs, and an append-only schema journal.

## Current status

Milestone 3 is implemented:

- pnpm monorepo
- strict TypeScript
- Fastify API scaffold with `/api/v1/health`
- Vite + React demo shell
- shared Zod contracts
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
  testing/    Network-free fixtures and fake model implementations
```

Later milestones add the `openai` package as implementation work begins.
