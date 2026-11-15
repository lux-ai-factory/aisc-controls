// Bring every project database to this app's schema, then exit.
//
// Runs as the controls-migrate service at start. A project made later is
// migrated by the web app the first time it is opened (src/lib/projectDb.ts),
// which runs this file with that database's name as its one argument.
//
// It migrates as controls_migrator (PROJECT_MIGRATE_DATABASE_URL), whose sessions
// act as controls_owner, the owner of every table it makes; the web app reads and
// writes them as controls_rw. A database is migrated only once its controls schema
// is controls_owner's (the platform hands it over after postgres-setup made the role).
//
// Exit 2 for a misconfiguration (the service stops), 1 when postgres cannot be
// listed yet or a schema has not been handed over yet (the service waits and tries
// again), 0 once every project database has been tried, even if some failed: those
// are logged, and one broken project must not keep controls-web from starting for
// all the others. A database named on the command line that fails exits 2.
import { execFileSync } from "node:child_process";
import pg from "pg";

import { SCHEMA_OWNER_QUERY, ownerProblem, pgConnectionString, sweep } from "./migrate-projects-lib.mjs";

const template = process.env.PROJECT_MIGRATE_DATABASE_URL ?? "";

async function listDatabases() {
  const catalog = new pg.Client({
    connectionString: pgConnectionString(template.replace("{database}", "postgres")),
    connectionTimeoutMillis: 5000,
  });
  await catalog.connect();
  try {
    const { rows } = await catalog.query("select datname from pg_database");
    return rows.map((r) => r.datname);
  } finally {
    await catalog.end();
  }
}

/** Whose the database's controls schema is: only its owner role's may be migrated. */
async function schemaProblem(url) {
  const client = new pg.Client({ connectionString: pgConnectionString(url), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rows } = await client.query(SCHEMA_OWNER_QUERY);
    return ownerProblem(rows[0]?.owner ?? null);
  } finally {
    await client.end();
  }
}

async function runner(_datname, url) {
  const problem = await schemaProblem(url);
  if (problem) throw Object.assign(new Error(problem.text), { wait: problem.wait });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

process.exit(await sweep({ template, listDatabases, runner, names: process.argv.slice(2) }));
