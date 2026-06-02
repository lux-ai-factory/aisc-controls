# AISC Controls

Compliance checklists — curate the questions and answer each checklist against
your AI system to capture audit evidence. Ships with
**17 bundled checklists (687 questions)** across **2 sources**
([AESIA](https://aesia.digital.gob.es/en/guides),
[EUSAiR](https://eusair-project.eu/)) that load automatically the first time
you start the app.

## Quick start

### Requirements

- **Node ≥ 18.18** (required by Next.js 15)
- **Docker** with the daemon running. Used for Postgres and for the bundled
  **PDF report renderer** (`services/pdf_renderer`). To use your own Postgres
  instead, copy `.env.example` → `.env`, edit `DATABASE_URL`, then run
  `npm run dev`; the setup script sees `.env` already exists and skips the
  docker step for the DB.

### Run it

The 17 bundled checklists, the library, filters, review, fill, and saved
submissions all work out of the box. Two commands:

```bash
npm install
npm run dev
```

On first run, `npm run dev` will:

1. Copy `.env.example` → `.env` if missing.
2. Start a Postgres container (`docker compose up -d db`) — **only when it
   created the `.env` in step 1**, so the bundled defaults match the bundled
   container.
3. Apply migrations (`prisma migrate deploy`).
4. Seed the bundled checklists (`prisma db seed`).
5. Best-effort start the bundled PDF report renderer
   (`docker compose up -d pdf`) — builds its image on first run. This step
   never blocks startup; if it fails, only report downloads are affected.
6. Boot Next.js at <http://localhost:3000> (falls back to 3001 if 3000 is busy).

Subsequent runs skip steps 1–4 (gated by
`node_modules/.cache/aisc-controls/setup-done`). Run `npm run setup` to force
a fresh setup.

You're done. Open the app and browse `/checklists`.

### Adding new checklists

New checklists are authored upstream and can be exported into this repo's
bundled examples — see [Bundled examples](#bundled-examples) below.

### Troubleshooting

- **`docker compose up` fails with "Cannot connect to the Docker daemon"** —
  start Docker Desktop / `dockerd` and re-run `npm run dev`.
- **Port already in use.** Next falls back from 3000 → 3001 automatically.
  Postgres is mapped to host `5444` (non-default, to avoid clashing with any
  Postgres already on `5432`) — free the port or change the mapping in
  `docker-compose.yml`.
- **"Download report" returns a 502 / "PDF renderer unreachable".** The renderer
  container isn't up. Start it with `docker compose up -d pdf` (first run builds
  the image, which can take a minute). It listens on host port `8005`; override
  with `PDF_RENDERER_URL` if you run it elsewhere.

## Running as an aisc platform app (apps/controls)

This repo runs two ways. **Standalone** (everything above) bundles its own
Postgres and bootstraps itself. **Platform mode** runs it as a submodule of the
[aisc](https://github.com/lux-ai-factory/aisc) platform, using the platform's
**shared** Postgres instead of its own.

Platform mode uses separate, additive files — the standalone setup is untouched:

| File | Role |
| --- | --- |
| `Dockerfile` | Builds the Next.js app image (`next build` → `next start`). |
| `docker-compose.development.yml` | `controls-web` + `controls-pdf` + a one-shot `controls-migrate`; **no** bundled `db`, **no** `name:`. |
| `env.development` | Service-name hosts (`db:5432`, `controls-pdf:8005`) + `AISC_PLATFORM=1`. |

Merge it with the platform infra (which provides the shared Postgres):

```bash
docker compose --env-file env.development \
  -f docker-compose-infra.development.yml \
  -f apps/controls/docker-compose.development.yml up
```

Platform-side wiring (handled in the parent `aisc` repo):

- The `controls` database must exist in the shared Postgres (Prisma applies the
  schema but does not create the database itself).
- Confirm the infra Postgres service is named `db` in `controls-migrate`'s
  `depends_on` (rename if yours differs).
- Add a Caddy route to `controls-web:3000`. For a **subpath** (e.g. `/controls`)
  build with `CONTROLS_BASE_PATH=/controls`; for a **subdomain**, leave it unset.

## Concepts

- **Source** — the authority, standards body, or organisation that published
  a document (e.g. AESIA, EUSAiR). Registered once via `/sources/new`, reused
  across many checklists, and surfaced as a clickable filter tag in the
  library. Each source can carry an attribution `citation` string and a `url`
  that get rendered alongside every checklist from it.
- **Checklist** — one source document, normalised into ordered questions.
  Tagged with `controlTopic`, `countryIds[]`, `regulationIds[]`, and an
  optional `sourceUpdatedAt` (the date the publishing authority last revised
  the document — required by some authorities when re-using their data).
- **Submission** — a saved set of answers against one checklist. Each answer
  can carry a 1–5 readiness **score**; submissions move through a
  **Draft → Closed** lifecycle, can be **reopened** into a new version
  (version chain), and **archived** / restored.
- **Report** — every submission has a **Download report (PDF)** action. The
  Next.js route (`/submissions/[id]/report`) builds a report payload and POSTs
  it to the bundled renderer (`services/pdf_renderer`, a FastAPI + WeasyPrint
  service on host port `8005`), which returns the PDF. Configure its location
  with `PDF_RENDERER_URL` (defaults to the bundled container).

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | First-run setup, then `next dev`. |
| `npm run setup` | Re-run the full first-run setup (DB up, migrate, seed). |
| `npm run db:up` / `db:down` | Start / stop the Postgres container. |
| `npm run db:reset` | Drop and recreate the DB (then re-seeds). |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run examples:export <id> [slug]` | Dump a checklist to `prisma/seed/examples/<slug>/`. |

## Bundled examples

`prisma/seed/examples/` ships 17 checklists:

- **AESIA** (12) — AI Act compliance checklists from the
  [Spanish Agency for the Supervision of Artificial Intelligence](https://aesia.digital.gob.es/en/guides).
- **EUSAiR** (5) — AI Act evaluation tools from the
  [EUSAiR project](https://eusair-project.eu/) (Data Governance, Data
  Dictionary, Human Oversight, Logging, Transparency).

Source-level attribution lives in `prisma/seed/sources.json` (citation, URL).
Per-checklist metadata lives in `prisma/seed/examples/<slug>/meta.json`
including the optional `sourceUpdatedAt` date. The seed is idempotent — it
skips entries whose title is already in the DB. To force a re-seed of one
entry, delete that checklist in Prisma Studio (`npm run db:studio`) first,
then `npm run db:seed`.

To add your own bundled example, create the checklist upstream, then run:

```bash
npm run examples:export <checklistId> [folder-slug]
```

This writes `meta.json` + `questions.json` into the folder; commit it and new
clones get the checklist on first run.

## Project layout

```
aisc-controls/
├─ docker-compose.yml         # Postgres
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts                 # replays sources.json + examples/* into the DB
│  └─ seed/
│     ├─ sources.json         # source registry (name, citation, url)
│     ├─ examples/            # bundled checklists (committed to git)
│     └─ export.ts            # CLI: dump a checklist from DB → examples/
├─ scripts/
│  └─ setup-once.mjs          # first-run bootstrapper invoked by `predev`
├─ services/
│  └─ pdf_renderer/           # FastAPI + WeasyPrint service → submission PDFs
├─ src/
│  ├─ app/
│  │  ├─ page.tsx             # homepage hero + stats
│  │  ├─ checklists/          # library, review, fill
│  │  ├─ sources/             # source registry CRUD
│  │  └─ submissions/         # answered checklists, version history, report PDF
│  ├─ components/
│  │  ├─ ChecklistMetaFields.tsx  # shared meta + chips form section
│  │  ├─ ScoreScale.tsx       # shared 1–5 readiness radio scale
│  │  ├─ SiteHeader.tsx
│  │  └─ SourceCitation.tsx   # citation / url / last-updated rendering
│  ├─ data/                   # countries + regulations taxonomies (JSON)
│  └─ lib/
│     ├─ checklistForm.ts     # shared FormData parsing + validation
│     ├─ scoring.ts           # score parsing + readiness % (pure)
│     ├─ questions.ts         # group questions by category (pure)
│     ├─ formatDate.ts        # dd/mm/yyyy user-facing date formatting
│     ├─ slugify.ts
│     └─ prisma.ts
└─ test/
   ├─ unit/                   # pure-logic unit tests (no DB)
   └─ integration/            # server-action tests (needs DATABASE_URL)
```

## Testing

```bash
npm test          # run everything once
npm run test:unit # unit tests only (pure logic, no database)
npm run test:watch
```

- **Unit tests** (`test/unit/`) cover the pure helpers in `src/lib/` — score
  parsing, readiness %, question grouping, slugify, date formatting, and the
  `FormData` parsers/validators. They need no database.
- **Integration tests** (`test/integration/`) drive the submission-lifecycle
  server actions (create, save & close, reopen as a new version, archive /
  restore) against a real database. They create and clean up their own rows, so
  they never disturb seeded data, and they **skip automatically when
  `DATABASE_URL` is not set**.

## License

Licensed under the [Apache License 2.0](./LICENSE).
