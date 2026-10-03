/**
 * A project database on the THROWAWAY Postgres, made with every platform template file
 * (the aisc repo's platform/project-template/), the way `platform_service.projectdb.provision`
 * makes one. The guards of ./throwawayDb.ts apply.
 *
 * A test that needs `project.system` asserts `hasTemplate("0006_project_system.sql")` first,
 * so it fails with a clear message instead of erroring.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { projectDatabaseName } from "@/lib/projectDb";
import { su } from "./throwawayDb";

// ISOLATION_TEMPLATE_DIR points this at another template directory (a scratch copy, say).
// Unset in a normal run.
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
  // makes is owned by platform_rw exactly as in a provisioned database.
  for (const file of templateFiles()) su(`SET ROLE platform_rw;\n${readFileSync(join(TEMPLATE_DIR, file), "utf8")}`, db);
  return pid;
}

/** A card version row, written the way the platform writes it (as platform_rw, its only writer). */
export function addSystemVersion(pid: string, versionPid: string, number: number): void {
  su(
    `SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES ('${versionPid}', ${number}, 'MCAS');`,
    projectDatabaseName(pid),
  );
}

/** The migration directory whose SQL adds the answer's foreign key to project.system, or undefined. */
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
