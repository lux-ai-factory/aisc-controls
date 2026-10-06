import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Two writes at once (code review 2026-10-06): two tabs, a double click, a review while someone answers.
// Each test makes the overlap happen for sure: it holds a row lock in a transaction of its own, starts the
// action, changes what the action read, then lets go.

const state = vi.hoisted(() => ({ latest: null as null | { pid: string; number: number } }));
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
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => state.latest }));

import { randomUUID } from "node:crypto";
import { hasThrowawayDb, makeProject, rows, su } from "./throwawayDb";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { saveDraft, reopenForAmendment, archiveSubmission } from "@/app/p/[project]/submissions/[id]/actions";
import { createSource } from "@/app/p/[project]/sources/new/actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function field(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

/** What the action ended with: the redirect's target, its returned state, or its error. */
async function outcome(fn: () => Promise<unknown>): Promise<{ redirect?: string; value?: unknown; error?: string }> {
  try {
    return { value: await fn() };
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) return { redirect: (err as { redirectUrl: string }).redirectUrl };
    return { error: String(err) };
  }
}

/** Whether a promise is still pending after `ms`. */
async function stillPending(p: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([p.then(() => false, () => false), sleep(ms).then(() => true)]);
}

describe.skipIf(!hasThrowawayDb)("two writes at once (integration)", () => {
  let project: string;
  let checklistId: string;
  let q1: string;

  beforeAll(async () => {
    vi.stubEnv("LEDGER_MODE", "record");
    project = makeProject();
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `Race ${tag}`, slug: `race-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: { title: `Race ${tag}`, sourceId: source.id, controlTopic: "T", questions: { create: [{ order: 1, text: "Q1?" }] } },
      include: { questions: true },
    });
    checklistId = checklist.id;
    q1 = checklist.questions[0].id;
  }, 60_000);

  afterAll(() => {
    vi.unstubAllEnvs();
    su(`drop database if exists ${projectDatabaseName(project)} with (force)`);
  });

  async function closed(label: string) {
    const prisma = await prismaFor(project);
    return prisma.submission.create({
      data: { checklistId, label, status: "Closed", closedAt: new Date(),
              answers: { create: [{ questionId: q1, answer: "a", score: 3 }] } },
    });
  }

  it("two reopens of one closed submission land on the same amendment", async () => {
    for (let i = 0; i < 3; i++) {
      const sub = await closed(`reopen ${i}`);
      const [a, b] = await Promise.all([
        outcome(() => reopenForAmendment(project, sub.id)),
        outcome(() => reopenForAmendment(project, sub.id)),
      ]);
      expect(a.error ?? b.error).toBeUndefined();
      expect(a.redirect).toBeDefined();
      expect(b.redirect).toBe(a.redirect);
      const prisma = await prismaFor(project);
      expect(await prisma.submission.count({ where: { previousVersionId: sub.id } })).toBe(1);
    }
  }, 60_000);

  it("two archives of one submission record one archived event", async () => {
    const sub = await closed("archive twice");
    await Promise.all([archiveSubmission(project, sub.id), archiveSubmission(project, sub.id)]);
    const events = rows(`SELECT action FROM ledger.outbox WHERE item_id = '${sub.id}'`, project);
    expect(events.filter((a) => a === "controls.submission.archived")).toHaveLength(1);
  }, 30_000);

  it("a save compares with the answers as they are under its lock, not as it read them before", async () => {
    // the draft's answer was "x" when this tab read it; another tab changed it to "y" before this save took
    // its lock: this tab's "x" is a change, stamped now, not the old answer's stamp kept
    const prisma = await prismaFor(project);
    const old = new Date("2026-01-01T00:00:00Z");
    const draft = await prisma.submission.create({
      data: { checklistId, label: "two tabs",
              answers: { create: [{ questionId: q1, answer: "x", score: 2, systemVersionNumber: 1, answeredAt: old }] } },
    });
    // an answer's stamp is a foreign key into this database's project.system
    state.latest = { pid: randomUUID(), number: 7 };
    su(`SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES ('${state.latest.pid}', 7, 'MCAS')`,
       projectDatabaseName(project));
    let save!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM controls.submission WHERE id = ${draft.id} FOR UPDATE`;
      save = saveDraft(project, draft.id, undefined, field({ label: "two tabs", [`a:${q1}`]: "x", [`s:${q1}`]: "2" }));
      await sleep(400);                                            // the save has read, and waits for the lock
      await tx.submissionAnswer.updateMany({ where: { submissionId: draft.id }, data: { answer: "y" } });
    }, { timeout: 20_000 });
    expect(await save).toBeUndefined();
    const [answer] = await prisma.submissionAnswer.findMany({ where: { submissionId: draft.id } });
    expect(answer.answer).toBe("x");
    expect(answer.systemVersionNumber).toBe(7);
    expect(answer.answeredAt.getTime()).toBeGreaterThan(old.getTime());
    state.latest = null;
  }, 30_000);

  it("a save waits for a review of its checklist, and is refused when the review replaced the questions", async () => {
    const prisma = await prismaFor(project);
    const draft = await prisma.submission.create({ data: { checklistId, label: "during a review" } });
    let save!: Promise<unknown>;
    let waited = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR UPDATE`;   // the review's lock
      save = saveDraft(project, draft.id, undefined, field({ label: "during a review", [`a:${q1}`]: "z" }));
      waited = await stillPending(save, 600);
      await tx.question.deleteMany({ where: { checklistId } });
      await tx.question.create({ data: { checklistId, order: 1, text: "Q1, revised?" } });
    }, { timeout: 20_000 });
    expect(waited).toBe(true);
    const result = (await save) as { error?: string } | undefined;
    expect(result?.error).toMatch(/revised/i);
    q1 = (await prisma.question.findFirstOrThrow({ where: { checklistId } })).id;
  }, 30_000);

  it("a new submission waits for a review of its checklist too, and is refused when the questions changed", async () => {
    const prisma = await prismaFor(project);
    let submit!: Promise<{ redirect?: string; value?: unknown; error?: string }>;
    let waited = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR UPDATE`;
      submit = outcome(() => submitForm(project, checklistId, undefined, field({ label: "new", [`a:${q1}`]: "z" })));
      waited = await stillPending(submit, 600);
      await tx.question.deleteMany({ where: { checklistId } });
      await tx.question.create({ data: { checklistId, order: 1, text: "Q1, revised again?" } });
    }, { timeout: 20_000 });
    expect(waited).toBe(true);
    const result = await submit;
    expect(result.error).toBeUndefined();
    expect((result.value as { error?: string } | undefined)?.error).toMatch(/revised/i);
    q1 = (await prisma.question.findFirstOrThrow({ where: { checklistId } })).id;
  }, 30_000);

  it("two editors registering the same source: one is registered, the other is told so", async () => {
    const name = `Same source ${randomUUID().slice(0, 6)}`;
    const results = await Promise.all([
      outcome(() => createSource(project, undefined, field({ name }))),
      outcome(() => createSource(project, undefined, field({ name }))),
    ]);
    expect(results.map((r) => r.error)).toEqual([undefined, undefined]);
    expect(results.filter((r) => r.redirect)).toHaveLength(1);
    expect(results.find((r) => !r.redirect)?.value).toEqual({ error: `"${name}" is already registered.` });
    const prisma = await prismaFor(project);
    expect(await prisma.source.count({ where: { name } })).toBe(1);
  }, 30_000);
});
