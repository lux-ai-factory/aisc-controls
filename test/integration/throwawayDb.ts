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
import { readFileSync } from "node:fs";
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

const TEMPLATE_0001 = fileURLToPath(
  new URL("../../../../platform/project-template/0001_controls.sql", import.meta.url),
);

/** A project database made the way the platform makes one (template 0001). */
export function makeProject(): string {
  const pid = randomUUID();
  const db = projectDatabaseName(pid);
  su(`CREATE DATABASE ${db} OWNER platform_rw`);
  su(readFileSync(TEMPLATE_0001, "utf8"), db);
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
