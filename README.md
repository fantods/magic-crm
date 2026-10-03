# Magic CRM

Magic CRM is a CRM whose logical schema emerges from the emails you paste into it. A lead can become a lead record, a support ticket can become a different kind of record, and repeated concepts such as “three clinics,” “six depots,” and “eighteen distribution centres” should fold into one durable `locations_count` column with the values `3`, `6`, and `18`.

This repository is a production-oriented technical demo. It does **not** use Evorozen Neural Pulse; the implementation plan uses PostgreSQL, OpenAI structured outputs, and an append-only schema journal.

## Current status

All twelve plan milestones are implemented. The highlights:

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
- platform chain (Milestones 9–12): production container images, Terraform
  AWS stack as code (validated, unapplied), Kubernetes manifests proven on
  kind, and a GitHub Actions pipeline (verify → GHCR images tagged by SHA →
  kind smoke test) with Prometheus metrics and a Grafana dashboard on the
  API

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

## Deployment

The repo ships production container images and a production-like full-stack
Compose file, separate from the development `docker-compose.yml` (which only
runs PostgreSQL for local dev).

### Images

Both images build from the repository root so the pnpm workspace, lockfile,
and workspace packages are in context:

```bash
docker build -f apps/api/Dockerfile -t formless-api:latest .
docker build -f apps/web/Dockerfile -t formless-web:latest .
```

- `apps/api/Dockerfile` — pinned `node:22.21.1-bookworm-slim`, builds the API
  and every workspace package it depends on, prunes to the production
  dependency closure (`pnpm deploy`), and runs as a non-root user. On boot it
  applies migrations, then serves. pnpm comes from the repo's pinned
  `packageManager` field via corepack.
- `apps/web/Dockerfile` — multi-stage: pinned Node image builds the Vite
  bundle, then `nginxinc/nginx-unprivileged:1.29.1-alpine` serves it with an
  SPA fallback, immutable caching for hashed assets, and an `/api/` reverse
  proxy so the browser talks to a single origin.

Root and per-image `.dockerignore` files (`.dockerignore`,
`apps/*/Dockerfile.dockerignore`) keep the build contexts small.

### Production-like stack

```bash
docker compose -f docker-compose.prod.yml up --wait --build
# Web demo:   http://localhost:8080 (nginx proxies /api/ to the API)
# API direct: http://localhost:3000/api/v1/health
docker compose -f docker-compose.prod.yml down --volumes
```

The stack runs PostgreSQL 16, the API, and the web app, with a healthcheck on
each service (postgres readiness, API `/api/v1/health`, web HTTP),
`restart: unless-stopped`, and a named volume for database data. The API applies
migrations on every boot.

`MODEL_MODE` defaults to `fake` here: the deterministic model double runs the
full ingestion and query pipeline with no OpenAI key and no network, which is
what the demo fixtures exercise. Set `MODEL_MODE=openai` (and `OPENAI_API_KEY`)
to serve the real model instead. To point the web bundle at an API hosted
elsewhere, rebuild with `--build-arg VITE_API_URL=https://api.example.com/api/v1`.

### AWS infrastructure as code

`infra/terraform/` provisions the cloud substrate behind these images (VPC,
ECR registries, RDS PostgreSQL 16, EKS) with Terraform. It is written and
validated only — nothing is provisioned. Layout, cost notes, plan/apply
order, and remote-state setup are documented in
`infra/terraform/README.md`.

### Kubernetes manifests

`infra/k8s/` holds Kustomize manifests (base + `local`/`aws` overlays) that
run the images on Kubernetes: Deployments, Services, Ingress, resource
budgets, probes on the existing health endpoints, and a keyless
`OPENAI_API_KEY` Secret template. The `local` overlay adds in-cluster
PostgreSQL and `MODEL_MODE=fake`, and the whole stack is proven on a local
`kind` cluster — exact commands in `infra/k8s/README.md` or one-shot via
`infra/k8s/scripts/local-verify.sh`. The `aws` overlay adapts the same
manifests to the Terraform stack (ECR images, RDS `DATABASE_URL`, ALB
ingress) as documentation-grade output, not a real deployment.

### CI/CD

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request, with only the default `GITHUB_TOKEN` (no custom secrets):

1. **verify** — lint, typecheck, unit/contract tests, and a full workspace
   build (the same commands as `pnpm lint` / `typecheck` / `test` / `build`).
2. **images** — builds both Milestone 9 Dockerfiles and pushes them to
   GitHub Container Registry as
   `ghcr.io/<owner>/<repo>/formless-api` and `.../formless-web`, each tagged
   with the full commit SHA. Fork pull requests build and smoke-test but
   skip the push (their token is read-only).
3. **kind-smoke** — proves the deployment end to end on every change: loads
   the exact images built in step 2 into a kind cluster, applies the
   Milestone 11 local overlay, waits for deployments to become available,
   and asserts the API health endpoint plus the keyless ingestion and query
   path through the ingress (`infra/k8s/scripts/local-verify.sh
--skip-build`), then tears the cluster down.

Images pushed from `main` are the deployable artifacts; the SHA tag is the
immutable reference per change (point any environment at it with
`kustomize edit set image formless-api=ghcr.io/<owner>/<repo>/formless-api:<sha>`).

### Observability

The API exposes Prometheus metrics on [`/api/v1/metrics`](http://127.0.0.1:3000/api/v1/metrics)
via the `fastify-metrics` plugin:

- HTTP request metrics — `http_request_duration_seconds` (histogram) and
  `http_request_summary_seconds`, labeled `method`, `route` (route template,
  e.g. `/api/v1/workspaces/:workspaceId/ingestions`), and `status_code`.
- Node.js process metrics — CPU, memory, event loop lag, GC, file
  descriptors.
- Privacy: metrics carry only route templates, methods, and status codes —
  query strings, request bodies, and email content never enter a metric
  (same posture as the logs).

The Kubernetes side is opt-in so the demo overlays stay lean:
`infra/k8s/base/monitoring/` holds a `ServiceMonitor` scraping the API
Service every 15s and the Grafana dashboard as a ConfigMap labeled
`grafana_dashboard: "1"` (auto-loaded by the kube-prometheus-stack Grafana
sidecar). Apply both with the overlay:

```bash
kubectl apply -k infra/k8s/overlays/monitoring
```

The dashboard (`Formless API`) covers request rate, latency percentiles
(p50/p90/p99), and error rate (5xx share, per route and by status code).
It requires a cluster with the Prometheus operator / kube-prometheus-stack
installed; see `infra/k8s/base/monitoring/` and `infra/k8s/README.md` for
the label tweaks some stacks need.

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
- Prometheus metrics are content-free: only route templates, HTTP methods,
  and status codes become labels — never URLs, bodies, or email content.
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
infra/
  terraform/ Terraform stack for AWS (VPC, ECR, RDS, EKS)
  k8s/       Kustomize manifests (base + local/aws/monitoring overlays),
             kind config, and the local-verify script
```
