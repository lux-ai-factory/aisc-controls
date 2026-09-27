// Bring every project database to this app's schema, then exit.
//
// Runs as the controls-migrate service at start. A project made later is
// migrated by the web app the first time it is opened (src/lib/projectDb.ts),
// so this is for schema changes reaching the projects that already exist.
//
// Exit 2 for a misconfiguration (the service stops), 1 when postgres cannot be
// listed yet (the service waits and tries again), 0 once every project
// database has been tried, even if some failed: those are logged, and one
// broken project must not keep controls-web from starting for all the others.
import { execFileSync } from "node:child_process";
import pg from "pg";

import { sweep } from "./migrate-projects-lib.mjs";

const template = process.env.PROJECT_DATABASE_URL ?? "";

async function listDatabases() {
  const catalog = new pg.Client({ connectionString: template.replace("{database}", "postgres").split("?")[0] });
  await catalog.connect();
  try {
    const { rows } = await catalog.query("select datname from pg_database");
    return rows.map((r) => r.datname);
  } finally {
    await catalog.end();
  }
}

function runner(_datname, url) {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

process.exit(await sweep({ template, listDatabases, runner }));
