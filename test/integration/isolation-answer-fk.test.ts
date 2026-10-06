import { describe, it, expect, afterAll } from "vitest";

// Inside a project database an answer's system_version_pid is a foreign key to
// project.system(pid), ON DELETE NO ACTION, added by a controls migration that refuses, with
// a clear message, when an answer names an absent pid.
//
// The project database is made with every platform template file (./isolationDb.ts), so
// project.system comes from the platform's real 0006_project_system.sql, not from a copy here.
// Without that file each test fails on "template 0006_project_system.sql missing".
// Runs only against a throwaway Postgres (see ./throwawayDb.ts).

import { randomUUID } from "node:crypto";

import { prismaFor, closeProjectDatabases, projectDatabaseName } from "@/lib/projectDb";
import { hasThrowawayDb, dropProject, rows, su } from "./throwawayDb";
import { addSystemVersion, fkMigration, hasTemplate, makeTemplatedProject } from "./isolationDb";

const V1 = "11111111-1111-4111-8111-111111111111";
const ABSENT = "99999999-9999-4999-8999-999999999999";

function needTemplate() {
  expect(hasTemplate("0006_project_system.sql"), "I2.1 template 0006_project_system.sql missing").toBe(true);
}

async function answered(project: string, pid: string | null) {
  const prisma = await prismaFor(project);
  const tag = randomUUID().slice(0, 8);
  const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
  const checklist = await prisma.checklist.create({
    data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "T", questions: { create: [{ order: 1, text: "Q?" }] } },
    include: { questions: true },
  });
  const submission = await prisma.submission.create({ data: { checklistId: checklist.id, label: "Run" } });
  const pidSql = pid === null ? "NULL" : `'${pid}'`;
  return () =>
    rows(
      `INSERT INTO controls.submission_answer (id, "submissionId", "questionId", answer, score, system_version_pid)
       VALUES ('a-${tag}', '${submission.id}', '${checklist.questions[0].id}', 'Yes', 4, ${pidSql}) RETURNING id`,
      project,
    );
}

describe.skipIf(!hasThrowawayDb)("I6.2: answers point at a card version of their own database", () => {
  const made: string[] = [];

  afterAll(async () => {
    await closeProjectDatabases();
    for (const pid of made) dropProject(pid);
  });

  it("I6.2: after migrating, the foreign key exists on project.system(pid), NO ACTION", async () => {
    needTemplate();
    const project = makeTemplatedProject();
    made.push(project);
    await prismaFor(project);
    expect(
      rows(
        `SELECT conname || '|' || confrelid::regclass::text || '|' || confdeltype::text FROM pg_constraint
          WHERE conrelid = 'controls.submission_answer'::regclass AND contype = 'f'
            AND conname = 'submission_answer_system_version_pid_fkey'`,
        project,
      ),
    ).toEqual(["submission_answer_system_version_pid_fkey|project.system|a"]);
  }, 120_000);

  it("I6.2: an answer stamped with a version of this database is accepted, an absent one is refused", async () => {
    needTemplate();
    const project = makeTemplatedProject();
    made.push(project);
    await prismaFor(project);
    addSystemVersion(project, V1, 1);
    expect((await answered(project, V1))()).toHaveLength(1);
    expect((await answered(project, null))()).toHaveLength(1); // unstamped answers stay allowed
    const bad = await answered(project, ABSENT);
    expect(bad).toThrow(/submission_answer_system_version_pid_fkey/);
  }, 120_000);

  it("I6.2: a version that an answer names cannot be deleted (NO ACTION)", async () => {
    needTemplate();
    const project = makeTemplatedProject();
    made.push(project);
    await prismaFor(project);
    addSystemVersion(project, V1, 1);
    (await answered(project, V1))();
    expect(() => su(`DELETE FROM project.system WHERE pid = '${V1}'`, projectDatabaseName(project))).toThrow(
      /submission_answer_system_version_pid_fkey/,
    );
  }, 120_000);

  it("I6.2: the migration refuses, naming the pid, when an answer names a version absent from project.system", async () => {
    needTemplate();
    const found = fkMigration();
    expect(found, "I6.2: no prisma migration adds submission_answer_system_version_pid_fkey").toBeDefined();
    const project = makeTemplatedProject();
    made.push(project);
    await prismaFor(project);
    const db = projectDatabaseName(project);
    // Back to the shape before the key, with an answer whose version is not in project.system,
    // as a database would look if the data move had not run before this migration.
    su(`ALTER TABLE controls.submission_answer DROP CONSTRAINT IF EXISTS submission_answer_system_version_pid_fkey`, db);
    (await answered(project, ABSENT))();
    let message = "";
    try {
      su(`SET ROLE controls_rw; SET search_path = controls;\n${found!.sql}`, db);
    } catch (err) {
      message = String((err as { stderr?: Buffer }).stderr ?? err);
    }
    expect(message).toMatch(/project\.system/);
    expect(message).toContain(ABSENT);
    expect(rows(`SELECT count(*) FROM pg_constraint WHERE conname = 'submission_answer_system_version_pid_fkey'`, project)).toEqual(["0"]);
  }, 120_000);
});
