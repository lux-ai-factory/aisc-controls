# AISC Controls

The controls checklists of AISC, the AI Assessment Sandbox Configurator. AISC
walks a project through six steps: 1 qualification, 2 control objectives,
3 install plugins and tools, 4 execute tests and address controls, 5 analyse
the results on the dashboard, 6 compose the report. This app is the "address
controls" half of step 4. A project installs compliance checklists (controls)
from the AISC catalogue, answers each one against its AI system with a 1 to 5
readiness score per question, and keeps the answered sheets (submissions)
through a Draft, Closed, reopened-as-new-version lifecycle, with a PDF report
for each. The results dashboard (step 5) and the report (step 6) read the
answers from the project's database.

An answered checklist shows two figures: **coverage**, the questions answered out
of all of them, and **readiness**, how far the scored ones are: each score on a
0-100% scale, 1 "Not started" at 0% and 5 "Optimized" at 100% ((score - 1) / 4),
averaged and rounded half up.

## How it works

- **Next.js 15 app** (`src/`), served under `/controls` behind the AISC
  gateway (Caddy + oauth2-proxy + Keycloak). Every project page lives under
  `/p/{project}/...`: the checklist library, the fill and review pages, the
  sources, and the submissions with their PDF report.
- **One Postgres database per project.** The platform service makes a database
  `project_<project id without hyphens>` when a project is created. This app
  keeps its tables in that database's `controls` schema (Prisma, connected as
  `controls_rw`) and nowhere else, so one project can never read another's
  answers. A project database is migrated the first time the app opens it,
  and every existing one is migrated at start by `scripts/migrate-projects.mjs`.
- **Access is decided by the platform.** Signing in is the gateway's job. On
  every request to a project page, `src/middleware.ts` asks the platform
  (`GET {PLATFORM_URL}/authz/projects/{project}`, with the caller's token)
  whether the person is in that project and may change it; every server action
  asks again for the project it was given. If the platform does not answer,
  the page answers 503: it never fails open.
- **Installing a checklist.** A checklist is installed from the project's own
  catalogue (public, or its private copy), opened from the launcher's project
  page: the catalogue's Install button calls this app's `/api/install` from the
  browser, only from `CATALOGUE_ORIGIN` or the launcher's origin (`LAUNCHER_URL`),
  where the stack serves the catalogue's pages. This app then asks the platform
  for the control's package (`GET {PLATFORM_URL}/projects/{pid}/catalogue/control/{slug}/export`,
  with the person's sign-in): the platform answers from the project's catalogue,
  so this app names no catalogue. The package is stored in the project's database.
  `/install` is the same as a page, for when the dialog cannot reach this app.
  This app has no catalogue page of its own since 2026-10-04.
- **AI card version.** Each answer is stamped with the AI card version that
  was the latest when it was given (`GET {PLATFORM_URL}/projects/{pid}/system-versions/latest`).
- **Ledger.** With `LEDGER_MODE` on, every write records an event with the
  project database's `ledger.emit()` in the same transaction as the change;
  the platform relays it to the immudb ledger.
- **PDF renderer** (`services/pdf_renderer`): a small FastAPI + Jinja +
  WeasyPrint service. The report route POSTs the submission's report JSON to
  it and streams back the PDF. Only report downloads depend on it.

```
browser -> gateway (Caddy /controls*) -> controls-web (Next.js)
                                           |-> platform        (who may do what, card versions)
                                           |   (also: the control packages, from the project's catalogue)
                                           |-> controls-pdf    (report PDF)
                                           '-> postgres: project_<pid>, schema controls
```

## Install and run

### Inside the AISC stack (the usual way)

The aisc repo's `docker-compose.development.yml` defines three services from
this repo:

| Service | What it does |
| --- | --- |
| `controls-migrate` | One-shot: `node scripts/migrate-projects.mjs` brings every project database to this app's schema, then exits. |
| `controls-web` | The app (`Dockerfile`, built with `NEXT_BASE_PATH=/controls`), on port 3000 inside the `backend`/`frontend` networks. |
| `controls-pdf` | The PDF renderer (`services/pdf_renderer/Dockerfile`), internal only. |

Both app services read `env.development` from this repo; the aisc compose file
adds the rest (platform, launcher, ledger, token). From the aisc repo root:

```bash
./scripts/secrets.sh      # once: writes env.secrets and env.runtime (CONTROLS_WEB_TO_PDF_TOKEN among them)
docker compose -p aisc --env-file env.runtime -f docker-compose.plugin_downloader.yml \
  -f docker-compose-infra.development.yml -f docker-compose.development.yml up -d --build
```

Then open <http://localhost:8100>, sign in, open a project and its step 4
controls page: the app is at `http://localhost:8100/controls/p/{project}/checklists`.
To rebuild only this app after a change:
`docker compose -p aisc --env-file env.runtime -f docker-compose-infra.development.yml -f docker-compose.development.yml up -d --build controls-migrate controls-web`.

The `docker-compose.development.yml` inside this repo is an older fragment
that the stack does not use and that no longer works (it migrates one shared
database); use the aisc repo's file.

### Standalone, for development

Prerequisites: Node 20 (the image uses `node:20`; `package.json` asks for
at least 18.18) with npm, and Docker for the bundled Postgres and PDF renderer.

```bash
npm install
npm run dev
```

`npm run dev` runs `scripts/setup-once.mjs` first, which:

1. copies `.env.example` to `.env` if there is none;
2. starts the bundled Postgres (`docker compose up -d db`, host port 5444) when
   `PROJECT_DATABASE_URL` points at it, on every run;
3. tries to start the PDF renderer (`docker compose up -d pdf`, host port 8005),
   without stopping on failure;
4. on the first run only, migrates the project databases that exist
   (marker: `node_modules/.cache/aisc-controls/setup-done`; `npm run setup`
   runs it all again);

then starts `next dev` on <http://localhost:3000>.

What this gives you is limited. The project pages need the platform: with
`PLATFORM_URL` empty (the `.env.example` default) every `/p/...` page answers
503, and with a platform the request also needs a signed-in caller's token,
which only the gateway adds. A project database must also exist, made by the
platform (its template creates schemas such as `project`, which the
`controls` migrations refer to). In practice, develop against the unit tests,
and check pages in the AISC stack. Nothing is seeded: a project's checklists
are the ones installed into it from the catalogue.

The bundled PDF renderer started by `docker-compose.yml` has no
`CONTROLS_WEB_TO_PDF_TOKEN`, so it refuses every report (503, shown as a 502
"PDF renderer" error). To try reports standalone, run the renderer by hand
with the token set (see [PDF renderer](#pdf-renderer)) and set the same
variable for `npm run dev`.

## Configuration

Environment variables read by the app (`src/`, `scripts/`, `next.config.ts`):

| Variable | Meaning | Default |
| --- | --- | --- |
| `PROJECT_DATABASE_URL` | Template of a project database's URL; `{database}` is replaced by `project_<pid without hyphens>`. Keep `schema=controls` and `connection_limit=2` (the app keeps at most 20 project databases open, so at most 40 connections). In the stack: `postgresql://controls_rw:<password>@postgres:5432/{database}?schema=controls&connection_limit=2` (`env.development`). | none: required |
| `DATABASE_URL` | Read by the Prisma CLI only. The app sets it per project for `prisma migrate deploy`; set it yourself for `npm run db:studio`, `db:seed` or `examples:export` on one project database. | none |
| `PLATFORM_URL` | The platform API: who is in which project, which projects a person may change, the latest AI card version. Empty means every project page answers 503. Stack: `http://platform:8000`. | empty |
| `LAUNCHER_URL` | The launcher, where a project is chosen; the app sends people there when they arrive without a project. Its origin may also call `/api/install`: the stack serves the catalogue's pages there. | `http://localhost:8100/` |
| `CATALOGUE_ORIGIN` | The hosted catalogue's origin, also allowed to call `/api/install` (the catalogue's own install dialog). With it and `LAUNCHER_URL` empty, every call is refused. Stack default: `https://sandboxconfigurator.aifactory.lu`. | empty |
| `PDF_RENDERER_URL` | The PDF renderer. Stack: `http://controls-pdf:8005`. | `http://localhost:8005` |
| `CONTROLS_WEB_TO_PDF_TOKEN` | Token sent to the renderer in `X-AISC-Service-Token`; the renderer needs the same value. Made by the aisc repo's `scripts/secrets.sh`. | none |
| `LEDGER_MODE` | `record` or `enforce` writes a ledger event with every change; anything else writes none. Stack: `${LEDGER_MODE:-off}`. | `off` |
| `NEXT_BASE_PATH` | Path prefix the app is served under, read at build time and by `next start`. Stack: `/controls`. | empty (served at the root) |
| `AISC_ENABLE_TEMPLATE_EDITOR` | `true` shows each checklist's "Edit template" action (the review page). | hidden |
| `AISC_PLATFORM` | `1` makes `scripts/setup-once.mjs` skip the standalone setup (set in `env.development`). | unset |

The PDF renderer reads `CONTROLS_WEB_TO_PDF_TOKEN`: without it, every path but
`/health` answers 503; with a wrong token, 401.

Test-only variables: `CONTROLS_TEST_PG_CONTAINER` and `ISOLATION_TEMPLATE_DIR`
(integration tests, below), `CHAIN_JSON` (the aisc pipeline chain).

## Tests

```bash
npx vitest run test/unit     # or: npm run test:unit
npm test                     # everything; the integration and chain tests skip themselves without their variables
```

- **Unit tests** (`test/unit/`) need no database and no network.
- **Integration tests** (`test/integration/`) need a throwaway Postgres, and
  the aisc checkout around this repo (they make project databases from the
  aisc repo's `platform/project-template/`). They skip unless
  `CONTROLS_TEST_PG_CONTAINER` names a container starting with `aisc-t-` and
  `PROJECT_DATABASE_URL` is not on port 5432, and they refuse to run their SQL
  otherwise. To make a throwaway one, from the aisc repo root, in bash:

  ```bash
  . scripts/lib/throwaway-pg.sh
  tpg_start controls          # container aisc-t-controls-<hex> on a free 127.0.0.1 port, removed when the shell exits
  tpg_init_platform .         # the roles and grants the stack's Postgres has
  tpg_su postgres -f - < init/report-roles.sql   # report_ro and dashboard_ro, which the grant tests check
  cd apps/controls
  CONTROLS_TEST_PG_CONTAINER=$TPG_NAME \
  PROJECT_DATABASE_URL="$(tpg_dsn controls_rw '{database}')?schema=controls&connection_limit=2" \
    npx vitest run test/integration
  ```

  **Never point the tests at the running stack's Postgres (port 5432).** It
  holds live data, and the tests create and drop databases.
- **Chain tests** (`test/chain/`) are steps of the aisc repo's
  `scripts/test-pipeline-chain.sh`, which sets `CHAIN_JSON` and a throwaway
  database; they skip otherwise.
- **PDF renderer tests**, see below.

### PDF renderer

```bash
cd services/pdf_renderer
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest httpx
pytest                                                           # the tests
CONTROLS_WEB_TO_PDF_TOKEN=<token> uvicorn app:app --port 8005    # run it
```

Python 3.12 (the image's version). WeasyPrint needs Pango, Cairo and
GDK-Pixbuf installed on the system (see its `Dockerfile`).

## Layout

```
src/app/p/[project]/   project pages: home, checklists (library, fill, review),
                       sources, submissions (version history, archive, report/route.ts)
src/app/install/       install one control into a chosen project (a page and its action)
src/app/api/install/   the same, for the catalogue's own dialog
src/lib/               project databases (projectDb.ts), access (access/), a control's
                       package (cataloguePackage.ts), install, scoring, report payload,
                       ledger events (ledger/)
src/middleware.ts      asks the platform about every /p/... request
prisma/                schema.prisma, migrations/, seed.ts and seed/ (sources and example checklists)
scripts/               migrate-projects.mjs (every project database), setup-once.mjs (standalone setup)
services/pdf_renderer/ the PDF renderer
test/                  unit/, integration/, chain/, fixtures/
```

`prisma/seed/` holds 17 example checklists from AESIA and EUSAiR
(`prisma/seed/examples/`, see its README) and their sources. Nothing seeds
them automatically; `DATABASE_URL='postgresql://.../project_<hex>?schema=controls' npm run db:seed`
loads them into one project database.

## Contributing

- Branch: `feat/unified-modules` is the only AISC branch to work on.
- Schema changes are Prisma migrations in `prisma/migrations/`
  (`npx prisma migrate dev` against a throwaway database). They run on every
  project database, at start (`controls-migrate`) and when a project is first
  opened, so they must work on databases with data in them. Do not edit an
  applied migration: Prisma checks each one's checksum, and some tests read
  their SQL.
- The `controls` migrations depend on the platform's project template (the
  `project` schema, the reader roles `dashboard_ro` and `report_ro`).
- `services/pdf_renderer/service_token.py` is the same file in every AISC
  service that has a service-token door; the aisc repo's
  `scripts/tests/test_service_tokens.py` checks that the copies are identical.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor licence terms.

## License

This project is licensed under the [Apache License 2.0](LICENSE.md).
© 2024–2026 Université du Luxembourg and Luxembourg Institute of Science and Technology.
