/**
 * A project database on a THROWAWAY Postgres, never the live one.
 *
 * The older integration tests run their superuser SQL with
 * `docker exec postgres ...`, which is the live stack's container. The tests
 * written for the 2026-09-23 pipeline use this helper instead: it runs the SQL
 * in the container named by CONTROLS_TEST_PG_CONTAINER and refuses to run at
 * all when that is unset or names the live container, or when
 * PROJECT_DATABASE_URL points at port 5432.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { projectDatabaseName } from "@/lib/projectDb";

const container = process.env.CONTROLS_TEST_PG_CONTAINER ?? "";
const template = process.env.PROJECT_DATABASE_URL ?? "";

/** True only when both variables point at a throwaway database. */
export const hasThrowawayDb =
  container.startsWith("aisc-t-") && template.includes("{database}") && !/:5432\//.test(template);

function guard() {
  if (!hasThrowawayDb) {
    throw new Error(
      "refusing: set CONTROLS_TEST_PG_CONTAINER=aisc-t-... and a PROJECT_DATABASE_URL that is not on :5432",
    );
  }
}

/** Run SQL as the superuser inside the throwaway container. */
export function su(sql: string, db = "platform"): string {
  guard();
  return execSync(
    `docker exec -i ${container} sh -c 'psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -qAt'`,
    { input: sql },
  ).toString();
}

// Isolation C1: a project database is made with EVERY platform template file, in order, as
// platform_rw (the role projectdb.provision connects as), exactly as isolationDb.makeTemplatedProject
// does. Controls' answer key refers to project.system (template 0006), so a database with only
// 0001 can no longer be migrated. ISOLATION_TEMPLATE_DIR as in ./isolationDb.ts. The loop is
// inline because isolationDb imports this file.
const TEMPLATE_DIR =
  process.env.ISOLATION_TEMPLATE_DIR ??
  fileURLToPath(new URL("../../../../platform/project-template/", import.meta.url));

/** A project database made the way the platform makes one (every template file). */
export function makeProject(): string {
  const pid = randomUUID();
  const db = projectDatabaseName(pid);
  su(`CREATE DATABASE ${db} OWNER platform_rw`);
  const files = readdirSync(TEMPLATE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of files) su(`SET ROLE platform_rw;\n${readFileSync(join(TEMPLATE_DIR, file), "utf8")}`, db);
  return pid;
}

export function dropProject(pid: string): void {
  su(`DROP DATABASE IF EXISTS ${projectDatabaseName(pid)} WITH (FORCE)`);
}

/** Rows of a query, as `|`-separated strings (psql -At). */
export function rows(sql: string, pid: string): string[] {
  return su(sql, projectDatabaseName(pid))
    .split("\n")
    .filter((line) => line.length > 0);
}
