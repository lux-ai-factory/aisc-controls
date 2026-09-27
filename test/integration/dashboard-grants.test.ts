import { describe, it, expect, afterAll } from "vitest";

// WP11 data (pipeline 2026-09-23, 03-specs.md, D5): the dashboard reads a
// project's answers with dashboard_ro. The tables belong to controls_rw
// (Prisma makes them), so the SELECT grant comes from a controls migration,
// 20260923210100_dashboard_reads_controls; the project template (0002) gives
// CONNECT and schema USAGE, which is simulated here.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { hasThrowawayDb, makeProject, dropProject, rows, su } from "./throwawayDb";
import { projectDatabaseName } from "@/lib/projectDb";

describe.skipIf(!hasThrowawayDb)("the dashboard may read a project's controls (WP11)", () => {
  let project: string;

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  it("the migration 20260923210100_dashboard_reads_controls is there", () => {
    const file = fileURLToPath(
      new URL("../../prisma/migrations/20260923210100_dashboard_reads_controls/migration.sql", import.meta.url),
    );
    expect(existsSync(file)).toBe(true);
  });

  it("dashboard_ro can SELECT every controls table after migrating, and nothing more", async () => {
    project = makeProject();
    const db = projectDatabaseName(project);
    // What template 0002_dashboard.sql grants (WP11, run by the platform).
    su(`GRANT CONNECT ON DATABASE ${db} TO dashboard_ro; GRANT USAGE ON SCHEMA controls TO dashboard_ro;`, db);
    await prismaFor(project); // migrates, as controls_rw

    for (const table of ["checklist", "checklist_question", "submission", "submission_answer", "source"]) {
      expect(rows(`SET ROLE dashboard_ro; SELECT count(*) FROM controls.${table};`, project)).toEqual(["0"]);
    }
    expect(() => rows(`SET ROLE dashboard_ro; DELETE FROM controls.submission_answer;`, project)).toThrow();
  }, 120_000);

  // Isolation C1 (01-specs.md I2.6, 03-coding-plan.md N5): this case used to pin that a later
  // table is readable through a default privilege. The approved design forbids reader grants by
  // default privilege (it would also cover secrets): readers get exactly the listed tables,
  // granted by the owner's migration 20260926000100_readers_read_the_listed_tables.
  it("I2.6: a table controls_rw makes later is not readable (no default privilege to a reader)", async () => {
    rows(`SET ROLE controls_rw; CREATE TABLE controls.later_table (id int);`, project);
    expect(() => rows(`SET ROLE dashboard_ro; SELECT count(*) FROM controls.later_table;`, project)).toThrow();
    expect(
      rows(
        `SELECT count(*) FROM pg_default_acl
          WHERE array_to_string(defaclacl, ',') ~ '(report_ro|dashboard_ro)='`,
        project,
      ),
    ).toEqual(["0"]);
  }, 60_000);

  it("I2.6: report_ro and dashboard_ro read exactly the five listed tables, not _prisma_migrations", async () => {
    const readable = (reader: string) =>
      rows(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'controls' AND c.relkind = 'r'
            AND has_table_privilege('${reader}', c.oid, 'SELECT') ORDER BY 1`,
        project,
      );
    const listed = ["checklist", "checklist_question", "source", "submission", "submission_answer"];
    expect(readable("dashboard_ro")).toEqual(listed);
    expect(readable("report_ro")).toEqual(listed);
    expect(rows(`SET ROLE report_ro; SELECT count(*) FROM controls.submission_answer;`, project)).toEqual(["0"]);
  }, 60_000);
});
