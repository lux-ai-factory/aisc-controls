# AISC Controls

The checklists of AISC, the AI Assessment Sandbox Configurator: the compose
services `controls-web` and `controls-pdf`. AISC walks a project through four
steps: 1 Qualify the AI system, 2 Set control objectives, 3 Choose tests and
checklists, 4 Collect evidence. A checklist is installed in step 3, from the
project's catalogue; this app is where people answer it, the "Answer
checklists" column of step 4.

Each question is answered with a score from 1 to 5 ("Not started" to
"Optimized"), with a written answer, or both; it counts as answered when it
has either. A set of answers (a submission) is a draft until it is closed;
reopening a closed submission makes a new version, and the closed one stays as
it was. Each submission can be downloaded as a PDF report. The platform (the
Collect evidence tiles and the Evidence map), the results dashboard and the
report read the answers from the project's database.

An answered checklist shows two figures: **coverage**, the questions answered
out of all of them, and **readiness** (labelled Maturity on this app's pages),
the mean of the scored questions on a 0-100% scale: each score counts
(score - 1) / 4, so 1 is 0% and 5 is 100%, averaged and rounded half up
(`src/lib/scoring.ts`).

What step 4 looks like as a whole is in the aisc repo's
`docs/appendices/4-collect-evidence.md`; how the services fit together is in
the aisc repo's `docs/architecture.md`.

## How it works

- **Next.js 15 app** (`src/`), served under `/controls` behind the AISC
  gateway (Caddy + oauth2-proxy + Keycloak). Every project page lives under
  `/p/{project}/...`: the installed checklists, the fill and review pages, and
  the submissions with their PDF report. A left menu leads to Installed
  checklists, Submissions and (at its bottom) Archived submissions;
  `/p/{project}` itself opens Installed checklists.
- **One Postgres database per project.** The platform service makes a database
  `project_<project id without hyphens>` when a project is created. This app
  keeps its tables in that database's `controls` schema (Prisma, connected as
  `controls_rw`) and nowhere else, so one project can never read another's
  answers. A project database is migrated the first time the app opens it,
  and every existing one is migrated at start by `scripts/migrate-projects.mjs`.
  The app keeps at most 20 project databases open; one closed to make room is
  reconnected later without migrating again (the process remembers the
  databases it migrated, and forgets one whose migration failed or that was
  found missing).
- **Access is decided by the platform.** Signing in is the gateway's job. On
  every request to a project page, `src/middleware.ts` asks the platform
  (`GET {PLATFORM_URL}/authz/projects/{project}?want={method}`, with the caller's
  token) whether the person may do that in that project, and returns the
  platform's refusal as it is; every server action asks again for the project it
  was given. If the platform does not answer, the page answers 503: it never
  fails open. The client is `src/vendor/aisc-access/`, a copy of the aisc repo's
  `shared/access-ts/` that a test keeps identical.
- **Installing a checklist.** A checklist is installed in step 3 from the
  project's own catalogue (public, or its private copy), opened from the
  launcher's project page: the catalogue's Install button calls this app's `/api/install` from the
  browser, only from `CATALOGUE_ORIGIN` or the launcher's origin (`LAUNCHER_URL`),
  where the stack serves the catalogue's pages. This app then asks the platform
  for the control's package (`GET {PLATFORM_URL}/projects/{pid}/catalogue/control/{slug}/export`,
  with the person's sign-in): the platform answers from the project's catalogue,
  so this app names no catalogue. The package is stored in the project's database.
  `/install` is the same as a page, for when the dialog cannot reach this app.
  The dialog marks the projects that already have the control (looked up in
  each listed project's database, at most 4 at a time). When the preselected
  project's catalogue cannot give the control (no catalogue chosen, 409, or no
  such control, 404), it tries the next listed projects, at most 5 in all, and
  preselects the first that gives it; with several projects it says whose
  catalogue the control is shown from.
  This app has no catalogue page of its own.
- **AI card version.** Each answer is stamped with the AI card version that
  was the latest when it was given (`GET {PLATFORM_URL}/projects/{pid}/system-versions/latest`).
- **The ledger.** With `LEDGER_MODE` on (the stack sets `record`), every write records an event with the
  project database's `ledger.emit()` in the same transaction as the change;
  the platform relays it to the immudb ledger. An event cites the gateway's
  `X-AISC-Request-Id` only when the request came through the gateway: it
  carries a gateway token (`X-Auth-Request-Access-Token`) that verifies against
  the realm's JWKS and was issued to `AISC_GATEWAY_CLIENT_ID`, and any Bearer
  token names the same person. Otherwise `request_id` is null. The JWKS read
  gives up after 2 seconds; when it fails, `request_id` is null and the JWKS
  is read again at most every 10 seconds. A review that removes answered
  questions records `controls.submission.answers_removed` for each submission
  that lost answers, so that submission's ledger chain continues unbroken.
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
adds the rest (the database password, platform, launcher, ledger, token). From
the aisc folder:

```bash
uv run scripts/aisc.py start
```

It makes the secrets if they are missing (`CONTROLS_WEB_TO_PDF_TOKEN` among them), builds and starts the
stack, and keeps port 443 answering on an https install.

Then open <http://localhost:8100>, sign in, open a project and its step 4
controls page: the app is at `http://localhost:8100/controls/p/{project}/checklists`.
To rebuild only this app after a change, run `uv run scripts/aisc.py secrets` in the aisc folder. It prints
this install's exact compose command, which ends in `up -d`. Append `--build controls-migrate controls-web`
to it.

### Standalone, for development

Prerequisites: Node 20 (the image uses `node:20`; `package.json` asks for
at least 18.18) with npm, and Docker for the bundled Postgres and PDF renderer.

```bash
npm install
npm run dev
```

`npm run dev` runs `scripts/setup-once.mjs` first, which:

1. copies `.env.example` to `.env` if there is none, and writes a random
   `CONTROLS_WEB_TO_PDF_TOKEN` into it when it has none;
2. starts the bundled Postgres (`docker compose up -d db`, host port 5444) when
   `PROJECT_DATABASE_URL` points at it, on every run;
3. tries to start the PDF renderer (`docker compose up -d pdf`, host port 8005,
   with the same token from `.env`), without stopping on failure;
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

The app and the bundled PDF renderer read the same `CONTROLS_WEB_TO_PDF_TOKEN`
from `.env`, so report PDFs work standalone too.

## Configuration

Environment variables read by the app (`src/`, `scripts/`, `next.config.ts`):

| Variable | Meaning | Default |
| --- | --- | --- |
| `PROJECT_DATABASE_URL` | Template of a project database's URL; `{database}` is replaced by `project_<pid without hyphens>`. Keep `schema=controls` and `connection_limit=2` (the app keeps at most 20 project databases open, so at most 40 connections). In the stack, compose sets `postgresql://controls_rw:<password>@postgres:5432/{database}?schema=controls&connection_limit=2` with the generated `controls_rw` password, or `CONTROLS_PROJECT_DATABASE_URL` when set. | none: required |
| `DATABASE_URL` | Read by the Prisma CLI only. The app sets it per project for `prisma migrate deploy`; set it yourself for `npm run db:studio`, `db:seed` or `examples:export` on one project database. | none |
| `PLATFORM_URL` | The platform API: who is in which project, which projects a person may change, the latest AI card version. Empty means every project page answers 503. Stack: `http://platform:8000`. | empty |
| `LAUNCHER_URL` | The launcher, where a project is chosen; the app sends people there when they arrive without a project. Its origin may also call `/api/install`: the stack serves the catalogue's pages there. | `http://localhost:8100/` |
| `CATALOGUE_ORIGIN` | The hosted catalogue's origin, also allowed to call `/api/install` (the catalogue's own install dialog). With it and `LAUNCHER_URL` empty, every call is refused. Stack default: `https://sandboxconfigurator.aifactory.lu`. | empty |
| `PDF_RENDERER_URL` | The PDF renderer. Stack: `http://controls-pdf:8005`. | `http://localhost:8005` |
| `CONTROLS_WEB_TO_PDF_TOKEN` | Token sent to the renderer in `X-AISC-Service-Token`; the renderer needs the same value. In the stack it is made by the aisc repo's `scripts/secrets.sh`; standalone, `scripts/setup-once.mjs` writes one into `.env`. | none |
| `LEDGER_MODE` | `record` or `enforce` writes a ledger event with every change; anything else writes none. Stack: `record` (`${LEDGER_MODE:-record}`). | `off` |
| `NEXT_BASE_PATH` | Path prefix the app is served under, read at build time and by `next start`. Stack: `/controls`. | empty (served at the root) |
| `AISC_ENABLE_TEMPLATE_EDITOR` | `true` turns on each checklist's "Edit questions" action (the review page), for administrators only (the platform's admin flag; no answer from the platform counts as no). Off, or for anybody else, the link is hidden, the page is not found and its save is refused ("Only an administrator can edit a checklist's template."). | off |
| `AUTH_ENABLED` | `false` keeps the presented `X-AISC-Request-Id` in ledger events without checking it (local work only). On, it is kept only when the gateway token verifies. | `true` |
| `KEYCLOAK_ISSUER` | The realm's issuer, checked in the gateway token. Without it or `KEYCLOAK_JWKS_URL` (and `AUTH_ENABLED` on), no event cites a request id. Stack: `${KEYCLOAK_URL_EXTERNAL}/realms/aisc`. | empty |
| `KEYCLOAK_JWKS_URL` | Where the realm's signing keys are fetched. Stack: `http://keycloak:8080/realms/aisc/protocol/openid-connect/certs`. | empty |
| `AISC_GATEWAY_CLIENT_ID` | The client the gateway token must be issued to (`azp`). | `aisc-gateway` |
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
  TPG_PG_ARGS="-c fsync=off -c full_page_writes=off -c synchronous_commit=off" \
    tpg_start controls        # container aisc-t-controls-<hex> on a free 127.0.0.1 port, removed when the shell exits;
                              # fsync off, or the DROP DATABASE in afterAll hooks can pass vitest's 10 s timeout
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
src/app/p/[project]/   project pages: checklists (library, fill, review), submissions
                       (version history, archive, report/route.ts); the entry redirects to checklists
src/app/install/       install one control into a chosen project (a page and its action)
src/app/api/install/   the same, for the catalogue's own dialog
src/lib/               project databases (projectDb.ts), access (access/), a control's
                       package (cataloguePackage.ts), install, scoring, report payload,
                       ledger events (ledger/)
src/middleware.ts      asks the platform about every /p/... request
prisma/                schema.prisma, migrations/, seed.ts and seed/ (sources and example checklists)
scripts/               migrate-projects.mjs (every project database), setup-once.mjs (standalone setup)
services/pdf_renderer/ the PDF renderer
test/                  unit/, integration/, chain/, fixtures/, vendor/ (the vendored copies' tests)
```

`prisma/seed/` holds 17 example checklists from AESIA and EUSAiR
(`prisma/seed/examples/`, see [its README](prisma/seed/examples/README.md))
and their sources. Nothing seeds them automatically; `DATABASE_URL='postgresql://.../project_<hex>?schema=controls' npm run db:seed`
loads them into one project database.

## Contributing

- Branch: `pilot` is the only AISC branch to work on.
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
