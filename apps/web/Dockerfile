# syntax=docker/dockerfile:1
# Production image for the demo UI: Vite build in a Node stage, static files
# served by unprivileged nginx.
#
# Build from the repository root so the pnpm workspace, lockfile, and the
# contracts package are all in context:
#
#   docker build -f apps/web/Dockerfile .
#
# The browser talks to a single origin: nginx serves the SPA and proxies
# /api/ to the API service (see nginx.conf). Point the built bundle at a
# different API base with:
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com/api/v1 .

# Pinned Node 22 LTS image; matches the repo's `engines` requirement.
FROM node:22.21.1-bookworm-slim AS build

# pnpm comes from the repo's pinned `packageManager` field via corepack.
RUN corepack enable

WORKDIR /repo

# API base URL baked into the static bundle at build time. The default works
# when nginx (or any reverse proxy) forwards /api/ to the API service.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

# Manifests first so the dependency-install layer caches independently of
# source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @formless/web... install --frozen-lockfile

# Build the bundle; the web app imports @formless/contracts, so its compiled
# output must exist first (`--filter @formless/web...` builds it too).
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @formless/web... build

# Unprivileged nginx: runs as uid 101, listens on 8080 by default.
FROM nginxinc/nginx-unprivileged:1.29.1-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
