# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js app. Used when running aisc-controls as an
# aisc platform service (apps/controls). Standalone dev still uses `npm run dev`
# and does NOT need this image.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
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

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# `next start` re-evaluates next.config.ts at runtime, which derives basePath from
# NEXT_BASE_PATH. Build ARG/ENV don't cross stages, so re-declare it here; without
# this the baked /controls prefix is dropped and the app serves at root
# (Caddy's /controls* route then 404s). next.config.ts is copied below.
ARG NEXT_BASE_PATH=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
# OpenSSL is required by the Prisma query engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# Full node_modules (incl. prisma CLI + tsx) so the migrate service can run
# `prisma migrate deploy` and `prisma db seed` from this same image.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
