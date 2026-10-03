# Acceptance-criteria verification

The plan's ten acceptance criteria (PLAN.md, "Initial acceptance criteria"),
each mapped to the automated check that proves it. All ten are verified in
this repository; none is skipped.

| #   | Criterion                                                                                                      | Verification                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pasting three industry examples creates records with a single `locations_count` column containing 3, 6, and 18 | `apps/api/src/ingestion-api.integration.test.ts` ("folds synonym counts…"); `apps/api/src/concurrency.integration.test.ts`; end to end: `e2e/demo.spec.ts` case 1                                       |
| 2   | Original phrases remain visible as evidence                                                                    | Ingestion API integration test (evidence assertions); `apps/web/src/App.test.tsx` (evidence UI); `e2e/demo.spec.ts` case 1 expands the evidence row                                                     |
| 3   | A support ticket creates a separate logical table                                                              | Ingestion API integration test ("creates a separate logical table for support tickets"); `e2e/demo.spec.ts` case 2                                                                                      |
| 4   | "Which leads have a budget over 5000?" returns the correct records without generating arbitrary SQL            | Query API integration test (`apps/api/src/query-api.integration.test.ts`); query compiler unit tests; `e2e/demo.spec.ts` case 3                                                                         |
| 5   | Submitting the same email twice creates one ingestion and one record                                           | Ingestion API integration test ("replays the same email…", "honors explicit idempotency keys"); database integration test (idempotent replay under concurrency)                                         |
| 6   | Five concurrent writes to one logical table create five records                                                | `apps/api/src/concurrency.integration.test.ts` (advisory-lock serialization, unique gap-free event sequences, five 201s)                                                                                |
| 7   | No schema event can be updated or deleted through application code                                             | `packages/database/src/schema-events-append-only.test.ts` (static scan of application code); `packages/database/src/migrator.integration.test.ts` (trigger rejects UPDATE/DELETE at the database level) |
| 8   | Unit and integration tests pass without network access                                                         | `pnpm test` runs the whole unit tier network-free; model calls go through the deterministic fakes in `@formless/testing` and injectable fetch doubles                                                   |
| 9   | The OpenAI key is never exposed to the browser                                                                 | ESLint import block (`eslint.config.js`, `no-restricted-imports` of `@formless/openai` in web code); web client carries no key; responses validated against shared contracts                            |
| 10  | A fresh clone can run the demo with documented Docker, migration, seed, and dev commands                       | `README.md` "Getting started (fresh clone)", `docs/local-setup.md` (steps verified end to end while landing this milestone), migration up/down checks in the migrator integration test                  |

## Environment notes

- The demo walkthrough and all database-backed tests were run in this
  environment against the Docker PostgreSQL service (`pnpm db:up`); the
  Playwright Chromium browser was installed into the worktree
  (`./.browsers`).
- The live OpenAI evaluation tier (real key against `api.openai.com`) is out
  of scope for this environment by design: every automated tier uses the
  deterministic fake model, per the plan's testing strategy.
