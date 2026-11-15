import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Every answer carries the AI card version that was the latest when it was
// answered. saveDraft deletes and recreates the rows, so an unchanged answer
// must carry its old stamp over, or every save would restamp every answer.
//
// The latest version is the project's own: a test makes the next one in the
// project's database, as the platform does when a card is saved.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts); who may write
// is mocked, as in submission-lifecycle.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: false, mayWrite: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  callerToken: async () => "caller-token",
}));

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { prismaFor, projectDatabaseName, projectDatabaseUrl, closeProjectDatabases } from "@/lib/projectDb";
import { saveDraft, reopenForAmendment } from "@/app/p/[project]/submissions/[id]/actions";

const AMEND = { reason: "Corrected a date", requestedBy: "Test auditor" };
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { hasThrowawayDb, makeProject, dropProject, rows, su } from "./throwawayDb";


type Stamp = { answer: string | null; score: number | null; pid: string | null; number: number | null; at: string | null };

/** The stamps of a submission's answers, by question, read with SQL so the
 *  test does not depend on the generated client knowing the new columns. */
function stamps(project: string, submissionId: string): Record<string, Stamp> {
  const out: Record<string, Stamp> = {};
  for (const line of rows(
    `SELECT "questionId", coalesce(answer, '<null>'), coalesce(score::text, '<null>'),
            coalesce(system_version_pid::text, '<null>'), coalesce(system_version_number::text, '<null>'),
            coalesce(answered_at::text, '<null>')
       FROM controls.submission_answer WHERE "submissionId" = '${submissionId}'`,
    project,
  )) {
    const [q, answer, score, pid, number, at] = line.split("|").map((v) => (v === "<null>" ? null : v));
    out[q as string] = {
      answer,
      score: score === null ? null : Number(score),
      pid,
      number: number === null ? null : Number(number),
      at,
    };
  }
  return out;
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) return (err as { redirectUrl: string }).redirectUrl;
    throw err;
  }
  throw new Error("expected a redirect");
}

describe.skipIf(!hasThrowawayDb)("answers carry the system version", () => {
  let project: string;
  let checklistId: string;
  let qA: string;
  let qB: string;

  /** The project's next card version, made in its database as the platform makes it. */
  let numbered = 0;
  function newVersion(): { pid: string; number: number } {
    const made = { pid: randomUUID(), number: ++numbered };
    su(
      "SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES " +
        `('${made.pid}', ${made.number}, 'MCAS')`,
      projectDatabaseName(project),
    );
    return made;
  }

  async function draft(label = "Run") {
    const prisma = await prismaFor(project);
    return (await prisma.submission.create({ data: { checklistId, label } })).id;
  }

  beforeAll(async () => {
    project = makeProject();
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: {
        title: `C ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "A?" }, { order: 2, text: "B?" }] },
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    checklistId = checklist.id;
    qA = checklist.questions[0].id;
    qB = checklist.questions[1].id;
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  it("the three stamp columns exist, nullable (the version key is isolation-answer-fk.test.ts's)", () => {
    const cols = rows(
      `SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns
        WHERE table_schema = 'controls' AND table_name = 'submission_answer'
          AND column_name IN ('system_version_pid','system_version_number','answered_at') ORDER BY 1`,
      project,
    );
    expect(cols).toEqual([
      "answered_at:timestamp with time zone:YES",
      "system_version_number:integer:YES",
      "system_version_pid:uuid:YES",
    ]);
  });

  it("a project with no card version yet saves its answers unstamped", async () => {
    const id = await draft();
    expect((await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" })))?.error).toBeUndefined();
    const s = stamps(project, id);
    expect(s[qA]).toMatchObject({ answer: "Yes", score: 3, pid: null, number: null });
    // It was answered now, even though there was no version to name.
    expect(s[qA].at).not.toBeNull();
  }, 60_000);

  it("an answer saved before the card had a version takes the version's stamp on its next save, even unchanged", async () => {
    // runs while the project still has no card version: the tests above make none
    const id = await draft();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" }));
    const unstamped = stamps(project, id)[qA];
    expect(unstamped.pid).toBeNull();

    const v1 = newVersion();
    expect((await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" })))?.error).toBeUndefined();
    const s = stamps(project, id)[qA];
    expect(s).toMatchObject({ answer: "Yes", score: 3, ...v1 });
    // the answer was given then, not now
    expect(s.at).toBe(unstamped.at);
    // and once stamped, it keeps that stamp through the next unchanged save
    newVersion();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" }));
    expect(stamps(project, id)[qA]).toMatchObject(v1);
  }, 60_000);

  it("A answered under one version, then B under the next: A keeps the first, B gets the next", async () => {
    const id = await draft();
    const v1 = newVersion();
    expect((await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" })))?.error).toBeUndefined();

    const v2 = newVersion();
    expect(
      (await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4", [`a:${qB}`]: "No", [`s:${qB}`]: "1" })))?.error,
    ).toBeUndefined();

    const s = stamps(project, id);
    expect(s[qA]).toMatchObject(v1);
    expect(s[qB]).toMatchObject(v2);
    expect(s[qA].at).not.toBeNull();
    expect(s[qB].at).not.toBeNull();
  }, 60_000);

  it("a changed answer is restamped with the version latest now", async () => {
    const id = await draft();
    newVersion();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const latest = newVersion();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "2" }));
    expect(stamps(project, id)[qA]).toMatchObject({ score: 2, ...latest });
  }, 60_000);

  it("an answer cleared but kept for its proof files loses its stamp", async () => {
    const id = await draft();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const prisma = await prismaFor(project);
    const answer = await prisma.submissionAnswer.findUniqueOrThrow({
      where: { submissionId_questionId: { submissionId: id, questionId: qA } } });
    await prisma.submissionAnswerFile.create({ data: { answerId: answer.id, fileId: randomUUID(), name: "p.pdf",
      mime: "application/pdf", size: 1, sha256: "ab".repeat(32) } });
    await saveDraft(project, id, undefined, form({ label: "Run" }));          // cleared; the row stays for its file
    expect(stamps(project, id)[qA]).toEqual({ answer: null, score: null, pid: null, number: null, at: null });
  }, 60_000);

  it("saving again with no change changes no stamp and no answered_at", async () => {
    const id = await draft();
    const v1 = newVersion();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const before = stamps(project, id);
    expect(before[qA].pid).toBe(v1.pid);

    newVersion();
    await new Promise((r) => setTimeout(r, 20));
    await saveDraft(project, id, undefined, form({ label: "Run renamed", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    expect(stamps(project, id)).toEqual(before);
  }, 60_000);

  it("the first fill stamps its answers too, not only a later save", async () => {
    const v1 = newVersion();
    const url = await captureRedirect(() =>
      submitForm(project, checklistId, undefined, form({ label: "First", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" })));
    const id = url.split("/").pop() as string;
    const first = stamps(project, id)[qA];
    expect([first.pid, first.number]).toEqual([v1.pid, v1.number]);
    expect(first.at).not.toBeNull();
    // and an answer left as it was keeps that stamp through a save under a newer version
    newVersion();
    await saveDraft(project, id, undefined, form({ label: "First", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    expect(stamps(project, id)[qA].pid).toBe(v1.pid);
  }, 60_000);

  it("amending a closed submission keeps each copied answer's stamp", async () => {
    const id = await draft();
    const v1 = newVersion();
    await saveDraft(project, id, undefined, form({ label: "Run", intent: "close", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const original = stamps(project, id);
    expect(original[qA].pid).toBe(v1.pid);

    newVersion();
    const url = await captureRedirect(() => reopenForAmendment(project, id, AMEND));
    const next = url.split("/").pop() as string;
    expect(next).not.toBe(id);
    expect(stamps(project, next)[qA]).toEqual(original[qA]);
  }, 60_000);
});

describe.skipIf(!hasThrowawayDb)("a project database made before answers were stamped", () => {
  let project: string;
  let tmp: string;

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("gains the stamp columns when first opened, and its old answers are unstamped", async () => {
    project = makeProject();
    // Migrate it with only the migrations from before the answer stamps.
    tmp = mkdtempSync(join(tmpdir(), "controls-pre-wp10-"));
    const prismaDir = fileURLToPath(new URL("../../prisma/", import.meta.url));
    cpSync(join(prismaDir, "schema.prisma"), join(tmp, "schema.prisma"));
    cpSync(join(prismaDir, "migrations", "migration_lock.toml"), join(tmp, "migrations", "migration_lock.toml"));
    cpSync(
      join(prismaDir, "migrations", "20260923120000_project_database"),
      join(tmp, "migrations", "20260923120000_project_database"),
      { recursive: true },
    );
    execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", join(tmp, "schema.prisma")], {
      // the older migrations as the stack runs them now: as controls_migrator, acting as controls_owner
      env: { ...process.env, DATABASE_URL: projectDatabaseUrl(project, process.env.PROJECT_MIGRATE_DATABASE_URL) },
      stdio: "pipe",
    });
    rows(
      `INSERT INTO controls.source (id, slug, name, updated_at) VALUES ('s1','s1','S1', now());
       INSERT INTO controls.checklist (id, title, "sourceId", "controlTopic", updated_at) VALUES ('c1','C1','s1','T', now());
       INSERT INTO controls.checklist_question (id, "checklistId", "order", text) VALUES ('q1','c1',1,'Q?');
       INSERT INTO controls.submission (id, "checklistId", label, updated_at) VALUES ('sub1','c1','old', now());
       INSERT INTO controls.submission_answer (id, "submissionId", "questionId", answer, score) VALUES ('a1','sub1','q1','Yes',4);`,
      project,
    );

    await prismaFor(project); // first open: migrate on open

    expect(
      rows(
        `SELECT coalesce(system_version_pid::text,'-') || '|' || coalesce(system_version_number::text,'-') || '|' || coalesce(answered_at::text,'-')
           FROM controls.submission_answer WHERE id = 'a1'`,
        project,
      ),
    ).toEqual(["-|-|-"]);
  }, 120_000);
});
