# Vera Controls

Compliance questionnaires — ingest documents from any authority, curate the
extracted questions, and compile each questionnaire against your AI system to
capture answers. Ships with **17 bundled questionnaires (687 questions)**
across **2 sources** ([AESIA](https://aesia.digital.gob.es/en/guides),
[EUSAiR](https://eusair-project.eu/)) that load automatically the first time
you start the app.

## Quick start

There are two paths depending on what you want to do. **Start with Path A.**
Add Path B later if you want to ingest your own documents.

### Requirements

- **Node ≥ 18.18** (required by Next.js 15)
- **Docker** with the daemon running (used for both Postgres and the bundled
  LLMFactory). To use your own Postgres instead, copy `.env.example` → `.env`,
  edit `DATABASE_URL`, then run `npm run dev`; the setup script sees `.env`
  already exists and skips the docker step.

---

### Path A — browse the bundled questionnaires (no API keys)

The 17 bundled questionnaires, the library, filters, review, fill, and saved
submissions all work with **no LLM and no API keys**. Two commands:

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
4. Seed the bundled questionnaires (`prisma db seed`).
5. Boot Next.js at <http://localhost:3000> (falls back to 3001 if 3000 is busy).

Subsequent runs skip steps 1–4 (gated by
`node_modules/.cache/vera-controls/setup-done`). Run `npm run setup` to force
a fresh setup.

You're done. Open the app and browse `/questionnaires`.

---

### Path B — also ingest new documents (needs an LLM API key)

Ingest is the **only** action that needs an LLM. To enable it on top of Path A:

```bash
# 1. Pick a model and add the matching provider key to .env. Mistral example:
echo 'LLM_MODEL=mistral-large-latest' >> .env
echo 'API_KEY_MISTRAL=...' >> .env

# 2. Build & start the bundled LLMFactory container (~2 min the first time)
npm run llm:up
```

3. Upload your document at <http://localhost:3000/questionnaires/new>.
4. `npm run llm:down` when you're done.

**About LLMFactory** — it ships in this repo at `services/llm_factory/`, a
small Flask app exposing `POST /execute_prompt` (`{ model, prompt }` →
`{ response }`) that forwards the request to whichever provider matches the
model. The bundled build supports:

| Provider | Models | Env var |
| --- | --- | --- |
| Mistral | `mistral-large-latest`, `mistral-medium-latest`, `ministral-8b-latest`, `ministral-3b-latest` | `API_KEY_MISTRAL` |
| Anthropic | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` | `API_KEY_ANTHROPIC` |

Add more by registering builders in
`services/llm_factory/llm_services/llm_factory.py`. All LLM traffic — UI
server actions and the CLI alike — goes through `src/lib/llmFactory.ts`; the
Node app imports no provider SDK directly.

---

### Troubleshooting

- **`docker compose up` fails with "Cannot connect to the Docker daemon"** —
  start Docker Desktop / `dockerd` and re-run `npm run dev`.
- **Port already in use.** Next falls back from 3000 → 3001 automatically.
  Postgres (`5444`) and LLMFactory (`5001`) don't — free the port or change
  the mapping in `docker-compose.yml`.
- **Changed `API_KEY_ANTHROPIC` (or any LLMFactory env var) but the container
  still uses the old value** — env is read at container start, so:
  `npm run llm:down && npm run llm:up`.
- **`npm run llm:up` looks frozen on first run.** It's pulling
  `python:3.12-slim` and installing pip deps — takes ~2 min on a clean
  machine. Watch with `docker compose --profile llm logs -f llm_factory` if
  you want to see progress.

## Concepts

- **Source** — the authority, standards body, or organisation that published
  a document (e.g. AESIA, EUSAiR). Registered once via `/sources/new`, reused
  across many questionnaires, and surfaced as a clickable filter tag in the
  library. Each source can carry an attribution `citation` string and a `url`
  that get rendered alongside every questionnaire from it.
- **Questionnaire** — one ingested document, normalised into ordered
  questions. Tagged with `controlTopic`, `countryIds[]`, `regulationIds[]`,
  and an optional `sourceUpdatedAt` (the date the publishing authority last
  revised the document — required by some authorities when re-using their
  data).
- **Submission** — a saved compilation of answers against one questionnaire.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | First-run setup, then `next dev`. |
| `npm run setup` | Re-run the full first-run setup (DB up, migrate, seed). |
| `npm run db:up` / `db:down` | Start / stop the Postgres container. |
| `npm run db:reset` | Drop and recreate the DB (then re-seeds). |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run llm:up` / `llm:down` | Start / stop the bundled LLMFactory container (only needed for ingest). |
| `npm run examples:export <id> [slug]` | Dump a questionnaire to `prisma/seed/examples/<slug>/`. |
| `npx tsx scripts/ingest-file.ts <file> [flags]` | CLI ingest (see below). |

### CLI ingest flags

```bash
npx tsx scripts/ingest-file.ts <file> \
  [--title "..."]        # default: filename stem
  [--topic "..."]        # default: derived from filename
  [--source "AESIA"]     # auto-upserts the Source row
  [--countries "EU,FR"]  # comma-separated country IDs from src/data/countries.json
  [--regulations "ai-act"] # comma-separated IDs from src/data/regulations.json
  [--description "..."]
```

## Bundled examples

`prisma/seed/examples/` ships 17 questionnaires:

- **AESIA** (12) — AI Act compliance checklists from the
  [Spanish Agency for the Supervision of Artificial Intelligence](https://aesia.digital.gob.es/en/guides).
- **EUSAiR** (5) — AI Act evaluation tools from the
  [EUSAiR project](https://eusair-project.eu/) (Data Governance, Data
  Dictionary, Human Oversight, Logging, Transparency).

Source-level attribution lives in `prisma/seed/sources.json` (citation, URL).
Per-questionnaire metadata lives in `prisma/seed/examples/<slug>/meta.json`
including the optional `sourceUpdatedAt` date. The seed is idempotent — it
skips entries whose title is already in the DB. To force a re-seed of one
entry, delete that questionnaire in Prisma Studio (`npm run db:studio`) first,
then `npm run db:seed`.

To add your own bundled example, ingest it through the UI then run:

```bash
npm run examples:export <questionnaireId> [folder-slug]
```

Drop the original source doc into the generated folder if you want it bundled
too, then commit. New clones will get it on first run.

## Project layout

```
vera_controls/
├─ docker-compose.yml         # Postgres + LLMFactory (the latter under `llm` profile)
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts                 # replays sources.json + examples/* into the DB
│  └─ seed/
│     ├─ sources.json         # source registry (name, citation, url)
│     ├─ examples/            # bundled questionnaires (committed to git)
│     └─ export.ts            # CLI: dump a questionnaire from DB → examples/
├─ scripts/
│  ├─ ingest-file.ts          # CLI ingest using the same pipeline as the UI
│  └─ setup-once.mjs          # first-run bootstrapper invoked by `predev`
├─ services/
│  ├─ llm_factory/            # bundled LLMFactory (Flask, /execute_prompt)
│  └─ pdf_renderer/
├─ src/
│  ├─ app/
│  │  ├─ page.tsx             # homepage hero + stats
│  │  ├─ questionnaires/      # library, ingest, review, fill
│  │  ├─ sources/             # source registry CRUD
│  │  └─ submissions/         # compiled forms
│  ├─ components/
│  │  ├─ QuestionnaireMetaFields.tsx  # shared meta + chips form section
│  │  ├─ SiteHeader.tsx
│  │  └─ SourceCitation.tsx   # citation / url / last-updated rendering
│  ├─ data/                   # countries + regulations taxonomies (JSON)
│  └─ lib/
│     ├─ ingest.ts            # parseDocument → extractQuestions → DB
│     ├─ extractQuestions.ts  # always routes through LLMFactory
│     ├─ llmFactory.ts        # thin HTTP client for services/llm_factory
│     ├─ parseDocument.ts     # docx / xlsx / csv / txt / md extraction
│     ├─ questionnaireForm.ts # shared FormData parsing + validation
│     ├─ slugify.ts
│     └─ prisma.ts
└─ style/                     # original LAIF design assets
```
