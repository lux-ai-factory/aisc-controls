# syntax=docker/dockerfile:1
# The image of the controls-web and controls-migrate services of the aisc stack.
# Standalone development uses `npm run dev` and does not need it.

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder
WORKDIR /app
# OpenSSL so Prisma generates the engine matching the runtime libssl (3.0.x).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Path-prefix routing (e.g. /controls behind Caddy). Empty = served at root.
ARG NEXT_BASE_PATH=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
RUN npx prisma generate && npm run build

FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner
WORKDIR /app
ENV NODE_ENV=production
# `next start` evaluates next.config.ts again at run time, and that reads basePath
# from NEXT_BASE_PATH. A build ARG/ENV does not cross stages, so it is declared
# again here: without it the app serves at the root and Caddy's /controls* route
# gets 404s.
ARG NEXT_BASE_PATH=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
# OpenSSL is required by the Prisma query engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# All of node_modules (with the prisma CLI and tsx), so controls-migrate can run
# scripts/migrate-projects.mjs (prisma migrate deploy on each project database)
# from this same image.
COPY --from=builder /app/node_modules ./node_modules
# next start writes its cache under .next, so the node user owns it
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
# migrate-projects.mjs, run by the controls-migrate service at start
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# the node image's own unprivileged user, not root
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
