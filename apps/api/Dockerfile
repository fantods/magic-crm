# syntax=docker/dockerfile:1
# Production image for the Fastify API.
#
# Build from the repository root so the pnpm workspace, lockfile, and
# workspace packages are all in context:
#
#   docker build -f apps/api/Dockerfile .
#
# The result is a self-contained /app: the API's production dependency
# closure (with built @formless/* workspace packages) plus the compiled API.

# Pinned Node 22 LTS image; matches the repo's `engines` requirement.
FROM node:22.21.1-bookworm-slim AS build

# pnpm comes from the repo's pinned `packageManager` field via corepack.
RUN corepack enable

WORKDIR /repo

# Manifests first so the dependency-install layer caches independently of
# source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/openai/package.json packages/openai/package.json
COPY packages/testing/package.json packages/testing/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Build the API and every workspace package it depends on, in topological
# order. `--filter @formless/api...` selects the API plus its workspace
# dependencies.
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @formless/api... build

# Prune to the API's production dependency closure. The deploy copies the
# @formless/* workspace packages (including their compiled dist) into
# /app/node_modules, so the runtime image carries no dev tooling.
RUN pnpm --filter @formless/api --prod deploy --legacy /out

FROM node:22.21.1-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Dedicated non-root user for the runtime stage.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app

WORKDIR /app

COPY --from=build --chown=app:app /out /app
# Belt and braces: every workspace package runs from its compiled dist, so
# copy the freshly built outputs over whatever the deploy snapshot carried.
COPY --from=build --chown=app:app /repo/apps/api/dist /app/dist
COPY --from=build --chown=app:app /repo/packages/contracts/dist /app/node_modules/@formless/contracts/dist
COPY --from=build --chown=app:app /repo/packages/core/dist /app/node_modules/@formless/core/dist
COPY --from=build --chown=app:app /repo/packages/database/dist /app/node_modules/@formless/database/dist
COPY --from=build --chown=app:app /repo/packages/openai/dist /app/node_modules/@formless/openai/dist
COPY --from=build --chown=app:app /repo/packages/testing/dist /app/node_modules/@formless/testing/dist

USER app

EXPOSE 3000

# Apply database migrations, then serve. `exec` hands PID 1 to the API so it
# receives the container's signals. Migrations are idempotent.
CMD ["sh", "-c", "node node_modules/@formless/database/dist/bin/migrate.js up && exec node dist/index.js"]
