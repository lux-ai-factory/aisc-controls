import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// A closed submission is frozen: each answer keeps the wording (article, category, place) of the question
// it answered, and the submission keeps the template revision it answered, so a later template edit
// never changes what it says. Drafts follow the template. Throwaway Postgres only.

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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  // an administrator: the template editor is for administrators only
  admit: async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: true, mayWrite: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  callerToken: async () => "caller-token",
}));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => null }));

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { prismaFor, projectDatabaseUrl, closeProjectDatabases } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { saveDraft, reopenForAmendment } from "@/app/p/[project]/submissions/[id]/actions";
import { saveReviewedQuestions } from "@/app/p/[project]/checklists/[id]/review/actions";
import { countries, regulations } from "@/data";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";

const MIGRATION = "20261018000000_closed_answers_keep_their_wording";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

async function redirected(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) return (err as { redirectUrl: string }).redirectUrl;
    throw err;
  }
  return "";
}

/** The wording each answer of a submission keeps, by answer text, read with SQL. */
function kept(project: string, submission: string): Record<string, string> {
  return Object.fromEntries(
    rows(
      `SELECT answer, coalesce(question_text, '-') || '|' || coalesce(question_article, '-') || '|'
              || coalesce(question_category, '-') || '|' || coalesce(question_order::text, '-')
         FROM controls.submission_answer WHERE "submissionId" = '${submission}'`,
      project,
    ).map((line) => {
      const [answer, ...rest] = line.split("|");
      return [answer, rest.join("|")];
    }),
  );
}

// The template editor is off unless its flag says otherwise; these tests use it, so it is on.
vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", "true");

const revisionOf = (project: string, submission: string) =>
  rows(`SELECT coalesce(questions_version::text, '-') FROM controls.submission WHERE id = '${submission}'`, project)[0];

describe.skipIf(!hasThrowawayDb)("a closed submission keeps the wording it answered", () => {
  let project: string;

  beforeAll(() => {
    project = makeProject();
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  beforeEach(() => {
    vi.stubEnv("LEDGER_MODE", "off");
  });

  async function checklist(): Promise<{ id: string; q: string[] }> {
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const made = await prisma.checklist.create({
      data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "Testing", questionsVersion: 3,
              questions: { create: [{ order: 1, text: "A?", article: "Art. 9", category: "Risk" },
                                    { order: 2, text: "B?" }] } },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    return { id: made.id, q: made.questions.map((x) => x.id) };
  }

  it("closing records each answer's question wording and the template revision", async () => {
    const { id, q } = await checklist();
    const sub = (await redirected(() => submitForm(project, id, undefined, form({ label: "Run", [`a:${q[0]}`]: "yes" }))))
      .split("/").pop() as string;
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${q[0]}`]: "yes", [`a:${q[1]}`]: "no", intent: "close" }));
    expect(kept(project, sub)).toEqual({ yes: "A?|Art. 9|Risk|1", no: "B?|-|-|2" });
    expect(revisionOf(project, sub)).toBe("3");
  });

  /** Save the template with these question rows (an id keeps that question). */
  async function review(id: string, rowsOfForm: { id?: string; text: string }[]): Promise<void> {
    const prisma = await prismaFor(project);
    const cl = await prisma.checklist.findUniqueOrThrow({ where: { id } });
    const fd = form({ title: cl.title, sourceId: cl.sourceId, controlTopic: cl.controlTopic });
    rowsOfForm.forEach((r, i) => {
      if (r.id) fd.set(`q.${i}.id`, r.id);
      fd.set(`q.${i}.text`, r.text);
    });
    fd.append("countryIds", countries[0].id);
    fd.append("regulationIds", regulations[0].id);
    expect(await redirected(() => saveReviewedQuestions(project, id, undefined, fd))).toBe(`/p/${project}/checklists?saved=1`);
  }

  /** A closed submission and a draft, both answering both questions. */
  async function answered() {
    const { id, q } = await checklist();
    const answers = (word: string) => ({ [`a:${q[0]}`]: `${word} a`, [`a:${q[1]}`]: `${word} b` });
    const closed = (await redirected(() => submitForm(project, id, undefined, form({ label: "Closed", ...answers("closed") }))))
      .split("/").pop() as string;
    await saveDraft(project, closed, undefined, form({ label: "Closed", ...answers("closed"), intent: "close" }));
    const draft = (await redirected(() => submitForm(project, id, undefined, form({ label: "Draft", ...answers("draft") }))))
      .split("/").pop() as string;
    return { id, q, closed, draft };
  }

  const outbox = (item: string) =>
    rows(`SELECT json_build_object('action', action, 'details', details, 'content', content) FROM ledger.outbox
           WHERE item_id = '${item}' ORDER BY occurred_at, event_id`, project)
      .map((line) => JSON.parse(line) as { action: string; details: Record<string, unknown>; content: Record<string, unknown> });

  it("rewording a question leaves a closed submission's wording as it was", async () => {
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[0], text: "A, reworded?" }, { id: q[1], text: "B?" }]);
    expect(kept(project, closed)).toEqual({ "closed a": "A?|Art. 9|Risk|1", "closed b": "B?|-|-|2" });
    expect(revisionOf(project, closed)).toBe("3");
  });

  it("removing a question keeps a closed submission's answer to it, and takes a draft's", async () => {
    const { id, q, closed, draft } = await answered();
    await review(id, [{ id: q[1], text: "B?" }]);
    expect(kept(project, closed)).toEqual({ "closed a": "A?|Art. 9|Risk|1", "closed b": "B?|-|-|2" });
    expect(rows(`SELECT count(*) FROM controls.submission_answer WHERE "submissionId" = '${closed}' AND "questionId" IS NULL`,
                project)).toEqual(["1"]);
    expect(rows(`SELECT answer FROM controls.submission_answer WHERE "submissionId" = '${draft}'`, project)).toEqual(["draft b"]);
  });

  it("an amendment of a closed submission leaves out its answers to removed questions", async () => {
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[1], text: "B?" }]);
    const next = (await redirected(() => reopenForAmendment(project, closed))).split("/").pop() as string;
    expect(rows(`SELECT answer FROM controls.submission_answer WHERE "submissionId" = '${next}'`, project)).toEqual(["closed b"]);
  });

  it("the ledger counts only the drafts' answers as removed, and keeps the closed answers it left", async () => {
    vi.stubEnv("LEDGER_MODE", "record");
    const { id, q, closed, draft } = await answered();
    await review(id, [{ id: q[1], text: "B?" }]);
    const [revised] = outbox(id).filter((e) => e.action === "controls.checklist.questions_revised");
    expect(revised.details).toMatchObject({ removed: 1, answers_removed: 1, closed_answers_removed: 0 });
    expect(revised.content.removed_answers).toEqual([expect.objectContaining({ submission: draft, answer: "draft a" })]);
    expect(revised.content.kept_answers).toEqual([expect.objectContaining({ submission: closed, answer: "closed a" })]);
    expect(outbox(closed).map((e) => e.action)).not.toContain("controls.submission.answers_removed");
    expect(outbox(draft).map((e) => e.action)).toContain("controls.submission.answers_removed");
  });

  it("a draft records neither: it follows the template until it is closed", async () => {
    const { id, q } = await checklist();
    const sub = (await redirected(() => submitForm(project, id, undefined, form({ label: "Run", [`a:${q[0]}`]: "yes" }))))
      .split("/").pop() as string;
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${q[0]}`]: "still yes" }));
    expect(kept(project, sub)).toEqual({ "still yes": "-|-|-|-" });
    expect(revisionOf(project, sub)).toBe("-");
  });
});

describe.skipIf(!hasThrowawayDb)("a project database from before answers kept their wording", () => {
  let project: string;
  let tmp: string;

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("gives its closed answers the wording of today, the best known, and leaves its drafts alone", async () => {
    project = makeProject();
    // Migrated with every migration from before this one.
    tmp = mkdtempSync(join(tmpdir(), "controls-pre-wording-"));
    const prismaDir = fileURLToPath(new URL("../../prisma/", import.meta.url));
    cpSync(join(prismaDir, "schema.prisma"), join(tmp, "schema.prisma"));
    for (const entry of readdirSync(join(prismaDir, "migrations"))) {
      if (entry >= MIGRATION && entry !== "migration_lock.toml") continue;
      cpSync(join(prismaDir, "migrations", entry), join(tmp, "migrations", entry), { recursive: true });
    }
    execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", join(tmp, "schema.prisma")], {
      env: { ...process.env, DATABASE_URL: projectDatabaseUrl(project) },
      stdio: "pipe",
    });
    rows(
      `INSERT INTO controls.source (id, slug, name, updated_at) VALUES ('s1','s1','S1', now());
       INSERT INTO controls.checklist (id, title, "sourceId", "controlTopic", updated_at, questions_version)
         VALUES ('c1','C1','s1','T', now(), 4);
       INSERT INTO controls.checklist_question (id, "checklistId", "order", text, article, category)
         VALUES ('q1','c1',1,'Q?','Art. 1','Cat');
       INSERT INTO controls.submission (id, "checklistId", label, status, updated_at) VALUES
         ('closed','c1','old','Closed', now()), ('draft','c1','open','Draft', now());
       INSERT INTO controls.submission_answer (id, "submissionId", "questionId", answer) VALUES
         ('a1','closed','q1','Yes'), ('a2','draft','q1','Maybe');`,
      project,
    );

    await prismaFor(project); // first open: migrate on open

    expect(kept(project, "closed")).toEqual({ Yes: "Q?|Art. 1|Cat|1" });
    expect(revisionOf(project, "closed")).toBe("4");
    expect(kept(project, "draft")).toEqual({ Maybe: "-|-|-|-" });
    expect(revisionOf(project, "draft")).toBe("-");
  }, 120_000);
});
