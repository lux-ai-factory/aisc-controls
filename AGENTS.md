# AGENTS.md — aisc-controls

**Target state:** a compliance domain *feature inside* the `backend` and `webapp` layers.
**Today:** a standalone Next.js + Prisma application (a vertical slice).

## Read first

The binding rules live in the parent repository, `lux-ai-factory/aisc`:
`ARCHITECTURE.md`, especially **I9** (a boundary follows the architectural axis, never a business
domain) and **I10** (the core never depends on an optional domain), and `docs/refactor-plan.md` §2.7.

## What binds this repo

- **I9** — a domain must not re-implement a layer: its UI belongs in `webapp`, its API and models in
  `backend`, its execution in `eval`.
- **I5** — one migration tool: today this repo carries its own Prisma schema and migrations.
- **I10** — the core must run with this domain absent; dependencies point coreward.

## Do not

- grow the slice: new endpoints, models or pages here widen the gap the plan closes — put them in
  `backend` / `webapp` and gate them with a feature flag.