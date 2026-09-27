/**
 * Isolation 2026-09-25 (docs/superpowers/isolation-2026-09-25/01-specs.md, 02-tests.md):
 * a project database on the THROWAWAY Postgres, made with EVERY platform template file that
 * exists (0001..0005 today, 0006_project_system.sql and later once WP P1 adds them), the way
 * `platform_service.projectdb.provision` makes one. The guards of ./throwawayDb.ts apply.
 *
 * A test that needs `project.system` asserts `hasTemplate("0006_project_system.sql")` first,
 * so it FAILS with "I2.1 template 0006_project_system.sql missing" instead of erroring.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { projectDatabaseName } from "@/lib/projectDb";
import { su } from "./throwawayDb";

// ISOLATION_TEMPLATE_DIR lets 02-tests.md's dry check point this at a scratch copy with a
// stand-in 0006, to prove the test bodies before WP P1 exists. Unset in every real run.
export const TEMPLATE_DIR =
  process.env.ISOLATION_TEMPLATE_DIR ??
  fileURLToPath(new URL("../../../../platform/project-template/", import.meta.url));

export function hasTemplate(file: string): boolean {
  return existsSync(join(TEMPLATE_DIR, file));
}

/** Every template file, in order, as the platform's runner applies them. */
export function templateFiles(): string[] {
  return readdirSync(TEMPLATE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

export function makeTemplatedProject(): string {
  const pid = randomUUID();
  const db = projectDatabaseName(pid);
  su(`CREATE DATABASE ${db} OWNER platform_rw`);
  // As platform_rw, the role projectdb.provision connects as, so every schema the template
  // makes is owned by platform_rw exactly as in a provisioned database (I1.2, D10).
  for (const file of templateFiles()) su(`SET ROLE platform_rw;\n${readFileSync(join(TEMPLATE_DIR, file), "utf8")}`, db);
  return pid;
}

/** A card version row, written the way the platform writes it (D2: platform_rw only). */
export function addSystemVersion(pid: string, versionPid: string, number: number): void {
  su(
    `SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES ('${versionPid}', ${number}, 'MCAS');`,
    projectDatabaseName(pid),
  );
}

/** The migration directory whose SQL adds the I6.2 key, or undefined. */
export function fkMigration(): { dir: string; sql: string } | undefined {
  const root = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
  for (const dir of readdirSync(root).sort()) {
    const file = join(root, dir, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");
    if (sql.includes("submission_answer_system_version_pid_fkey")) return { dir, sql };
  }
  return undefined;
}
