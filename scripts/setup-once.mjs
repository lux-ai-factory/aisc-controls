// Startup setup: makes a working DB available, applies migrations, and seeds
// the bundled examples. Bringing Postgres up runs on EVERY `npm run dev` so a
// stopped container heals and the persistent volume (with your answered
// checklists) is reconnected. Migrations + seeding are gated by a marker file
// so we only pay that cost once. Everything is idempotent — deleting the
// marker, or re-seeding, is always safe (the seed skips checklists already in
// the DB and never touches submissions).

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

// Platform mode: running as an aisc submodule against shared infra. The platform
// owns Postgres and applies migrations via its own init service (controls-migrate),
// so this standalone bootstrap must not start a second DB or re-seed.
if (process.env.AISC_PLATFORM === "1") {
  console.log("[setup] AISC_PLATFORM=1 — skipping standalone infra bootstrap.");
  process.exit(0);
}

// 1. ensure .env exists (copy from template on first run)
const envFile = path.resolve(".env");
const envExample = path.resolve(".env.example");
let envWasCreated = false;
if (!existsSync(envFile) && existsSync(envExample)) {
  copyFileSync(envExample, envFile);
  envWasCreated = true;
  console.log("[setup] created .env from .env.example");
}

// 2. load .env so DATABASE_URL is visible here and to spawned `prisma` calls
loadDotenv(envFile);

if (!process.env.DATABASE_URL) {
  console.warn(
    "[setup] DATABASE_URL not set — edit .env then run `npm run setup`.",
  );
  process.exit(0);
}

// 3. bring Postgres up via docker compose whenever DATABASE_URL points at the
// bundled service. Doing this unconditionally (not just on first run) means a
// failed earlier attempt — or a stopped container — heals on the next
// `npm run dev` instead of stranding the user. `docker compose up -d` is
// idempotent: a no-op when the container is already running and healthy.
const composeFile = path.resolve("docker-compose.yml");
const usesBundledDb = (process.env.DATABASE_URL ?? "").startsWith(
  "postgresql://aisc:aisc@localhost:5444/aisc",
);
if (usesBundledDb && existsSync(composeFile) && hasCommand("docker")) {
  console.log("[setup] ensuring Postgres is up (docker compose up -d db)…");
  runStrict("docker", ["compose", "up", "-d", "db"]);
  if (!waitForDbHealthy(60_000)) {
    console.error("[setup] Postgres did not become healthy in time.");
    process.exit(1);
  }
} else if (usesBundledDb && !hasCommand("docker")) {
  console.warn(
    "[setup] docker not found — install Docker, or point DATABASE_URL in .env at your own Postgres before continuing.",
  );
  process.exit(1);
}

// 3b. Best-effort: bring up the bundled PDF report renderer. The core app does
// not depend on it, so a slow first-time image build or a start failure here
// only disables the "Download report (PDF)" action — it must never block
// `npm run dev`. Hence runLoose (warn, don't exit) rather than runStrict.
if (existsSync(composeFile) && hasCommand("docker")) {
  console.log("[setup] ensuring PDF renderer is up (docker compose up -d pdf)…");
  runLoose("docker", ["compose", "up", "-d", "pdf"]);
}

// 4. migrate + seed — gated by the marker so it only runs the first time.
// The DB is already up (step 3 above) on every run, so re-runs just reconnect
// to the persistent volume and keep every answered checklist intact.
if (existsSync(MARKER)) {
  console.log("[setup] already initialised — DB is up, skipping migrate/seed.");
  process.exit(0);
}

console.log("[setup] applying migrations…");
runStrict("npx", ["prisma", "migrate", "deploy"]);

console.log("[setup] seeding bundled examples…");
runStrict("npx", ["prisma", "db", "seed"]);

mkdirSync(MARKER_DIR, { recursive: true });
writeFileSync(MARKER, new Date().toISOString());
console.log("[setup] done.");

// ---------- helpers ----------

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

// Like runStrict, but a failure only warns and lets setup continue — for
// optional, non-blocking steps (e.g. the PDF renderer container).
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
