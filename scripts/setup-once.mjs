// Standalone setup, run before every `npm run dev`: makes Postgres available
// and migrates the project databases that already exist. Postgres is brought
// up on every run, so a stopped container comes back and its volume (with the
// answered checklists) is reconnected. The migration sweep runs once, gated by
// a marker file. Nothing is seeded: a project's checklists are the ones
// installed into it from the catalogue. Every step is idempotent.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const MARKER_DIR = path.resolve("node_modules/.cache/aisc-controls");
const MARKER = path.join(MARKER_DIR, "setup-done");
// The `db` service of this repo's docker-compose.yml, on its host port.
const BUNDLED_DB_URL = "postgresql://aisc:aisc@localhost:5444/";

// Platform mode: running inside the aisc stack. The stack owns Postgres and
// migrates the project databases with its controls-migrate service, so this
// standalone setup must not start a second database.
if (process.env.AISC_PLATFORM === "1") {
  console.log("[setup] AISC_PLATFORM=1 — skipping standalone infra bootstrap.");
  process.exit(0);
}

// 1. Make .env from .env.example if it is missing.
const envFile = path.resolve(".env");
const envExample = path.resolve(".env.example");
let envWasCreated = false;
if (!existsSync(envFile) && existsSync(envExample)) {
  copyFileSync(envExample, envFile);
  envWasCreated = true;
  console.log("[setup] created .env from .env.example");
}

// 2. Load .env so PROJECT_DATABASE_URL is visible here and to spawned commands.
// There is no single app database: each project has its own, and this is the
// template its URL is made from.
loadDotenv(envFile);

const projectDatabaseUrl = process.env.PROJECT_DATABASE_URL ?? "";
if (!projectDatabaseUrl.includes("{database}")) {
  console.warn(
    process.env.DATABASE_URL && !projectDatabaseUrl
      ? "[setup] .env sets DATABASE_URL, which this app no longer reads. Set PROJECT_DATABASE_URL instead, e.g.\n" +
          '[setup]   PROJECT_DATABASE_URL="postgresql://aisc:aisc@localhost:5444/{database}?schema=controls&connection_limit=2"\n' +
          "[setup] then run `npm run setup`."
      : "[setup] PROJECT_DATABASE_URL not set, or has no {database} — edit .env then run `npm run setup`.",
  );
  process.exit(0);
}

// 3. Bring Postgres up with docker compose whenever PROJECT_DATABASE_URL points at
// the bundled `db` service. This runs every time, not only the first, so a failed
// earlier attempt or a stopped container is fixed by the next `npm run dev`.
// `docker compose up -d` does nothing when the container is already running.
const composeFile = path.resolve("docker-compose.yml");
const usesBundledDb = projectDatabaseUrl.startsWith(BUNDLED_DB_URL);
if (usesBundledDb && existsSync(composeFile) && hasCommand("docker")) {
  console.log("[setup] ensuring Postgres is up (docker compose up -d db)…");
  runStrict("docker", ["compose", "up", "-d", "db"]);
  if (!waitForDbHealthy(60_000)) {
    console.error("[setup] Postgres did not become healthy in time.");
    process.exit(1);
  }
} else if (usesBundledDb && !hasCommand("docker")) {
  console.warn(
    "[setup] docker not found — install Docker, or point PROJECT_DATABASE_URL in .env at your own Postgres before continuing.",
  );
  process.exit(1);
}

// 3b. Best effort: bring up the bundled PDF report renderer. The app does not
// depend on it, so a slow first image build or a failed start only disables the
// "Download report (PDF)" action and must never block `npm run dev`: hence
// runLoose (warn and go on) rather than runStrict.
if (existsSync(composeFile) && hasCommand("docker")) {
  console.log("[setup] ensuring PDF renderer is up (docker compose up -d pdf)…");
  runLoose("docker", ["compose", "up", "-d", "pdf"]);
}

// 4. Migrate the project databases that exist, only on the first run (the
// marker). A project database made later is migrated by the app the first time
// it is opened, so this is never the only chance.
if (existsSync(MARKER)) {
  console.log("[setup] already initialised — DB is up, skipping the migration sweep.");
  process.exit(0);
}

console.log("[setup] migrating the project databases…");
runStrict("node", ["scripts/migrate-projects.mjs"]);

mkdirSync(MARKER_DIR, { recursive: true });
writeFileSync(MARKER, new Date().toISOString());
console.log("[setup] done.");

function hasCommand(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function runStrict(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`[setup] \`${cmd} ${args.join(" ")}\` failed.`);
    process.exit(r.status ?? 1);
  }
}

// Like runStrict, but a failure only warns and lets setup continue: for
// optional steps such as the PDF renderer container.
function runLoose(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.warn(
      `[setup] \`${cmd} ${args.join(" ")}\` failed — continuing without it.`,
    );
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForDbHealthy(timeoutMs) {
  const start = Date.now();
  process.stdout.write("[setup] waiting for Postgres…");
  while (Date.now() - start < timeoutMs) {
    const r = spawnSync(
      "docker",
      ["compose", "exec", "-T", "db", "pg_isready", "-U", "aisc", "-d", "aisc"],
      { stdio: "ignore" },
    );
    if (r.status === 0) {
      process.stdout.write(" ready.\n");
      return true;
    }
    process.stdout.write(".");
    sleepMs(1000);
  }
  process.stdout.write("\n");
  return false;
}

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let [, key, value] = m;
    if (process.env[key] !== undefined) continue; // don't override real env
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
