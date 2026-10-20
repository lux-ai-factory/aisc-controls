import { describe, it, expect, afterAll } from "vitest";

// The dashboard reads a project's answers with dashboard_ro. The tables belong to controls_rw
// (Prisma makes them), so the SELECT grant comes from a controls migration,
// 20260923210100_dashboard_reads_controls; the project template (0002) gives
// CONNECT and schema USAGE, which is simulated here.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts).

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { hasThrowawayDb, makeProject, dropProject, rows, su } from "./throwawayDb";
import { projectDatabaseName } from "@/lib/projectDb";

describe.skipIf(!hasThrowawayDb)("the dashboard may read a project's controls", () => {
  let project: string;

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  it("dashboard_ro can SELECT every controls table after migrating, and nothing more", async () => {
    project = makeProject();
    const db = projectDatabaseName(project);
    // What the platform's template 0002_dashboard.sql grants.
    su(`GRANT CONNECT ON DATABASE ${db} TO dashboard_ro; GRANT USAGE ON SCHEMA controls TO dashboard_ro;`, db);
    await prismaFor(project); // migrates, as controls_rw

    for (const table of ["checklist", "checklist_question", "submission", "submission_answer", "source"]) {
      expect(rows(`SET ROLE dashboard_ro; SELECT count(*) FROM controls.${table};`, project)).toEqual(["0"]);
    }
    expect(() => rows(`SET ROLE dashboard_ro; DELETE FROM controls.submission_answer;`, project)).toThrow();
  }, 120_000);

  // Readers get no default privilege (it would also cover tables holding secrets): they get
  // exactly the listed tables, granted by the owner's migration
  // 20260926000100_readers_read_the_listed_tables.
  it("a table controls_rw makes later is not readable (no default privilege to a reader)", async () => {
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

  it("report_ro and dashboard_ro read exactly the five listed tables, not _prisma_migrations", async () => {
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
