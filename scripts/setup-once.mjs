// First-run setup: makes a working DB available, applies migrations, and seeds
// the bundled examples. Re-runs are gated by a marker file so `npm run dev`
// only pays the cost once. Everything is idempotent — deleting the marker is
// always safe.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const MARKER_DIR = path.resolve("node_modules/.cache/vera-controls");
const MARKER = path.join(MARKER_DIR, "setup-done");

if (existsSync(MARKER)) process.exit(0);

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
  "postgresql://vera:vera@localhost:5444/vera",
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

// 4. migrate + seed
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForDbHealthy(timeoutMs) {
  const start = Date.now();
  process.stdout.write("[setup] waiting for Postgres…");
  while (Date.now() - start < timeoutMs) {
    const r = spawnSync(
      "docker",
      ["compose", "exec", "-T", "db", "pg_isready", "-U", "vera", "-d", "vera"],
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
