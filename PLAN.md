# Formless Implementation Plan

## Confirmed product decisions

- **Product:** web application with a polished technical-demo page.
- **Quality bar:** production-level architecture and safeguards, even though the first release is a demo.
- **Email input:** paste-only in v1.
- **Frontend:** Vite + React + TypeScript.
- **Repository layout:** monorepo.
- **Datastore:** PostgreSQL instead of Evorozen Neural Pulse.
- **AI provider:** OpenAI.
- **Ingestion model passes:** separate architect and reviewer calls.
- **Schema evolution:** strict append/merge-only; no destructive renames or deletes.
- **Source fidelity:** preserve original wording and evidence for extracted values.
- **Record cardinality:** one primary record per email in v1.
- **Column types:** text, integer, decimal, boolean, date, datetime, enum, email, URL, JSON.
- **Queries:** equality, comparison, contains, AND/OR, and sorting. No joins or aggregation in v1.
- **Query generation:** constrained structured DSL, validated before execution.
- **Workspaces:** workspace ID isolation in v1; authentication can be added later.
- **Privacy:** emails may be sent to OpenAI by the server, but are not written to application logs.

## Recommended stack

- **Runtime:** Node.js 22 LTS.
- **Package manager:** pnpm with workspace protocol.
- **Language:** TypeScript in strict mode everywhere.
- **Frontend:** Vite, React, TypeScript, TanStack Query, Tailwind CSS or plain CSS modules.
- **API:** Fastify.
- **Database:** PostgreSQL 16.
- **SQL access:** `pg` with hand-written, parameterized SQL. An ORM is unnecessary because the application-owned tables are fixed while CRM records are JSON documents.
- **Validation:** Zod for API contracts, model outputs, and the query DSL.
- **AI:** OpenAI Responses API with structured outputs.
- **Default model:** `gpt-5.1`, configurable through `OPENAI_MODEL`. This gives the schema reasoning passes a quality-focused default; a smaller model can be configured for cheaper demos. Model selection can be revisited after evaluation fixtures are in place.
- **Tests:** Vitest, Testing Library, Supertest, and Playwright for the demo path.
- **Local infrastructure:** Docker Compose for PostgreSQL.

The README's Evorozen-only datastore requirement is superseded by this plan. The README should be updated as part of the first implementation milestone.

## Monorepo layout

```text
apps/
  api/                 Fastify HTTP API and job orchestration
  web/                 Vite React demo UI
packages/
  contracts/           Shared API, domain, and query DTOs
  core/                Schema catalogue, ingestion pipeline, query engine
  database/            PostgreSQL migrations, repositories, locks
  openai/              OpenAI adapter and deterministic model double
  testing/             Fixtures, fake model, database helpers
```

Shared code must depend on `contracts`, not on the frontend or API packages.

## Core architecture

### 1. Email normalization

The API accepts:

```ts
type IngestEmailInput = {
  workspaceId: string;
  subject?: string;
  body: string;
  from?: string;
  to?: string;
  receivedAt?: string;
  idempotencyKey?: string;
};
```

Normalization:

- trims and normalizes line endings,
- separates quoted reply blocks when possible,
- computes a stable content hash,
- preserves the original subject/body for evidence,
- derives an idempotency key when one is not supplied.

### 2. Logical schema model

The CRM schema is logical rather than represented as dynamically generated physical SQL tables. PostgreSQL owns fixed application tables, while user-defined CRM records are JSONB documents keyed by their logical table and workspace.

This preserves the user-visible promise that support tickets and leads become different kinds of tables while avoiding unsafe runtime DDL.

Core types:

```ts
type ColumnType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'email'
  | 'url'
  | 'json';

type RecordTable = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  aliases: string[];
  createdAt: string;
};

type RecordColumn = {
  id: string;
  workspaceId: string;
  tableId: string;
  name: string;
  type: ColumnType;
  description?: string;
  aliases: string[];
  unit?: string;
  enumValues?: string[];
  createdAt: string;
};
```

Column IDs are stable. Human names can be improved over time, but old names remain aliases.

### 3. Append-only schema journal

`schema_events` is the source of truth for schema evolution. `record_tables` and `record_columns` are transactional projections used for efficient access.

Event types:

- `table_proposed`
- `table_accepted`
- `table_rejected`
- `column_proposed`
- `column_accepted`
- `column_rejected`
- `column_merged`
- `record_created`

Every event includes:

- workspace ID,
- monotonically increasing sequence within that workspace,
- ingestion ID,
- actor/model metadata,
- deterministic JSON payload,
- creation timestamp.

Update and delete permissions on `schema_events` are revoked in migration code. A trigger may also reject mutations.

### 4. Architect model pass

Input:

- normalized email,
- existing logical tables and columns for the workspace,
- current column aliases and descriptions.

Responsibilities:

- classify the email as one existing table or propose one new table,
- map extractable facts to existing columns where reasonable,
- propose new columns only when no existing semantic match exists,
- choose a conservative canonical type,
- extract source spans or exact source phrases.

The architect never mutates the database.

### 5. Reviewer model pass

Input:

- normalized email,
- current schema,
- complete architect proposal,
- previous reviewer policy and examples.

Responsibilities:

- approve, reject, or rename proposed tables and columns,
- merge synonyms into existing columns,
- avoid creating columns for one-off prose,
- require precise, durable names,
- resolve type conflicts conservatively,
- explain every decision.

The reviewer is the only component allowed to approve a final schema delta.

### 6. Synonym and evidence handling

The demonstration requirement is:

> “three clinics”, “six depots”, and “eighteen distribution centres” become one `locations_count` column containing 3, 6, and 18.

Behavior:

- Canonical value: `3`, `6`, or `18`.
- Column name: `locations_count`.
- Column aliases accumulate: `clinics`, `depots`, `distribution centres`, `sites`, etc.
- Record evidence retains the exact source phrase and location where available.

Example record:

```json
{
  "data": {
    "locations_count": 3
  },
  "evidence": {
    "locations_count": [
      {
        "source": "body",
        "text": "three clinics"
      }
    ]
  }
}
```

The reviewer should prefer a generic durable name when the semantic concept is generic. If two facts are genuinely different, such as `employees_count` and `locations_count`, they must remain separate columns.

### 7. Record creation

One accepted email creates exactly one primary record in v1.

A record contains:

- immutable record ID,
- workspace ID,
- logical table ID,
- canonical JSON data,
- evidence map,
- schema revision,
- source email metadata,
- stable content hash,
- idempotency key,
- creation timestamp.

Secondary entities mentioned in an email are stored as JSON values inside the primary record, not as additional top-level records.

## PostgreSQL design

### Application-owned tables

- `workspaces`
- `ingestions`
- `schema_events`
- `record_tables`
- `record_columns`
- `records`

### Key constraints

- `schema_events(workspace_id, sequence)` is unique.
- `record_tables(workspace_id, name)` has a case-insensitive unique constraint.
- `record_columns(workspace_id, table_id, name)` has a case-insensitive unique constraint.
- `ingestions(workspace_id, idempotency_key)` is unique.
- `records(workspace_id, idempotency_key)` is unique.
- All record and schema queries filter by `workspace_id`.
- JSONB GIN indexes support initial demo queries.

### Transactions and concurrency

PostgreSQL transactions replace the need for the README's custom per-table write queue.

For each ingestion:

1. Insert or find the ingestion row by idempotency key.
2. Return the existing result immediately if already completed.
3. Acquire a transaction-level advisory lock for the logical table.
4. Append schema events.
5. Update the schema projection.
6. Insert the record.
7. Commit once.

Lock key:

```text
workspace_id:record_table_id
```

Application-level queues may be added for request coalescing, but PostgreSQL advisory locks remain the correctness boundary for multi-process deployments.

### Workspace isolation

Every repository method requires a workspace ID and includes it in SQL predicates. Row-level security can be added later when authenticated users and workspace roles exist.

## Query system

### Structured DSL

```ts
type QueryFilter =
  | { kind: 'logical'; operator: 'and' | 'or'; children: QueryFilter[] }
  | {
      kind: 'comparison';
      columnId: string;
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
      value: string | number | boolean | null | Array<string | number>;
    };

type RecordQuery = {
  workspaceId: string;
  tableId: string;
  filter?: QueryFilter;
  orderBy?: {
    columnId: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
};
```

### Safety rules

- The model emits a `RecordQuery`, never SQL.
- Zod validates the query.
- Column IDs must exist in the selected workspace and table.
- Values are cast according to the column type.
- SQL is generated with parameter placeholders and internal IDs only.
- Limit is capped at 200.
- Query execution is read-only.

### Query planner call

The query planner receives:

- user question,
- selected table or table catalogue,
- current columns, aliases, types, and units.

It returns:

- structured query,
- human-readable interpretation,
- assumptions or ambiguity warnings.

## OpenAI integration

- Calls are made only by `apps/api` or `packages/openai`; the browser never sees the OpenAI key.
- Use structured outputs with schemas equivalent to the Zod contracts.
- Validate and normalize model output before domain code sees it.
- Retry only transient transport/server failures, with a small bounded attempt count.
- Do not retry after a database mutation begins.
- Include model name, call purpose, latency, token counts, and request ID in operational metadata; do not log full email bodies.
- A deterministic `FakeModelClient` implements the same interface for all unit tests and most integration tests.

## API design

All routes are versioned under `/api/v1`.

### Workspaces and schema

- `GET /health`
- `GET /workspaces/:workspaceId`
- `GET /workspaces/:workspaceId/schema`
- `GET /workspaces/:workspaceId/schema/events`

### Ingestion

- `POST /workspaces/:workspaceId/ingestions`
- `GET /workspaces/:workspaceId/ingestions/:ingestionId`

### Records

- `GET /workspaces/:workspaceId/tables/:tableId/records`
- `GET /workspaces/:workspaceId/records/:recordId`

### Query

- `POST /workspaces/:workspaceId/query`

The API can remain synchronous in v1. A background job queue is unnecessary unless model latency or browser timeouts become a problem.

## Demo UI

### Layout

1. **Email input panel**

   - large paste area,
   - subject and optional metadata fields,
   - submit button,
   - example-email buttons.

2. **Generated schema panel**

   - logical tables,
   - columns, types, aliases, and descriptions,
   - schema revision.

3. **Records panel**

   - selected table,
   - dynamically generated columns,
   - canonical values,
   - evidence tooltips or expandable source excerpts.

4. **Audit/journal panel**

   - append-only decisions,
   - architect proposal,
   - reviewer decision and rationale,
   - accepted, rejected, and merged columns.

5. **Natural-language query panel**
   - question input,
   - interpreted structured query,
   - result table,
   - warning when the question is ambiguous.

### Demo examples

The demo should include:

1. three industry emails producing `locations_count` values `3`, `6`, and `18`,
2. a support ticket creating a distinct logical table,
3. the query “Which leads have a budget over 5000?”.

## Testing strategy

### Network-free tests

- Email normalization.
- Contract validation.
- Architect output normalization.
- Reviewer decisions.
- Synonym merging.
- Schema journal folding.
- Projection consistency.
- Query DSL validation.
- SQL generation.
- Type casting.
- Workspace isolation.
- Idempotency.
- Concurrent writes.
- UI ingestion flow using the fake model.

### Database tests

Use an isolated PostgreSQL schema per test file or transaction rollback. These tests do not call OpenAI.

### Live-model evaluation

A small, separately invoked evaluation suite exercises OpenAI. It is excluded from normal test runs unless explicitly enabled. Its purposes are:

- compare model configurations,
- detect prompt regressions,
- validate the three `locations_count` examples,
- measure reviewer rejection quality.

### Production-readiness checks

- Strict TypeScript.
- Lint and formatting.
- Parameterized SQL only.
- Database migration up/down checks.
- Idempotency tests.
- Concurrent ingestion test.
- API error contract tests.
- Frontend accessibility checks.
- Playwright demo walkthrough.

## Implementation milestones

### Milestone 1 — Repository and contracts

**Status: implemented. Dependency installation and lockfile creation remain pending because npm registry DNS is unavailable in the current sandbox.**

- pnpm workspace setup.
- TypeScript project references.
- ESLint, Prettier, Vitest.
- Docker Compose PostgreSQL.
- Shared Zod contracts.
- Basic Fastify and Vite scaffolds.
- Update README to reflect PostgreSQL and OpenAI.

### Milestone 2 — Database core

**Status: implemented. Live PostgreSQL integration tests are prepared but skipped unless
`TEST_DATABASE_URL` is set; Docker is not exposed to the current sandbox.**

- PostgreSQL migrations.
- Workspace repository.
- Schema journal repository.
- Logical table and column projections.
- Record repository.
- Transaction and advisory-lock helpers.
- Idempotency constraints.

### Milestone 3 — Deterministic ingestion core

**Status: implemented and covered by network-free tests.**

- Normalized email model.
- Architect proposal contract.
- Reviewer decision contract.
- Schema delta calculator.
- Column merge logic.
- Evidence model.
- Fake model fixtures.

### Milestone 4 — OpenAI integration

**Status: implemented and covered by network-free tests. The adapter is exercised
through an injectable fetch double, so no normal test run contacts OpenAI; a
live-key evaluation harness remains milestone 8 territory.**

- OpenAI client adapter.
- Structured-output schemas.
- Architect prompt.
- Reviewer prompt.
- Bounded retries.
- Operational metadata.
- Failure normalization.

### Milestone 5 — Ingestion API

- `POST /ingestions`.
- Single-transaction orchestration.
- Idempotent replay.
- Schema and record responses.
- Audit event exposure.

### Milestone 6 — Query engine and API

- Query DSL validation.
- JSONB SQL compiler.
- Query planner prompt and adapter.
- `POST /query`.
- Result interpretation response.

### Milestone 7 — Demo web app

- App shell and design system.
- Email paste form.
- Schema catalogue view.
- Dynamic record grid.
- Evidence inspection.
- Journal view.
- Query interface.
- Example demo scripts.

### Milestone 8 — Production hardening

- Concurrency stress test.
- Migration checks.
- Security headers and CORS.
- Rate limiting.
- Structured operational logs.
- Error telemetry hooks.
- Accessibility audit.
- Playwright end-to-end demo.
- README and local setup guide.

## Initial acceptance criteria

1. Pasting three industry examples creates records with a single `locations_count` column containing 3, 6, and 18.
2. Original phrases remain visible as evidence.
3. A support ticket creates a separate logical table.
4. The query “Which leads have a budget over 5000?” returns the correct records without generating arbitrary SQL.
5. Submitting the same email twice creates one ingestion and one record.
6. Five concurrent writes to one logical table create five records.
7. No schema event can be updated or deleted through application code.
8. Unit and integration tests pass without network access.
9. The OpenAI key is never exposed to the browser.
10. A fresh clone can run the demo with documented Docker, migration, seed, and dev commands.

## Open implementation choices

These do not block Milestone 1:

- Tailwind versus CSS modules.
- Playwright component tests versus browser-only end-to-end tests.
- Whether to expose schema decisions through WebSockets later.
- Whether to add background ingestion jobs after measuring model latency.
- Whether production deployment uses Neon, RDS, or another managed PostgreSQL service.
