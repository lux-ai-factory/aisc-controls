import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// A review keeps what it does not change (2026-10-06). It replaced every question as soon as one changed,
// and the database cascaded every answer away, closed submissions' too: fixing a typo in one question of
// forty erased ten finished assessments. Now each row of the review form names its question: a kept
// question keeps its id and its answers (a reworded one too), a removed one takes only its own answers, a
// new one is added. Throwaway Postgres only.

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
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => null }));

import { randomUUID } from "node:crypto";

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { saveReviewedQuestions } from "@/app/p/[project]/checklists/[id]/review/actions";
import { saveDraft } from "@/app/p/[project]/submissions/[id]/actions";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";
import { countries, regulations } from "@/data";

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

type Row = { id?: string; text: string };

describe.skipIf(!hasThrowawayDb)("a review keeps the questions it does not remove, and their answers", () => {
  let project: string;

  beforeAll(() => {
    project = makeProject();
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  beforeEach(() => {
    vi.stubEnv("LEDGER_MODE", "record");
  });

  /** A checklist of three questions, a closed submission and a draft answering all of them. */
  async function answered(): Promise<{ id: string; q: string[]; closed: string; draft: string }> {
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const made = await prisma.checklist.create({
      data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "Testing",
              questions: { create: [{ order: 1, text: "A?" }, { order: 2, text: "B?" }, { order: 3, text: "C?" }] } },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    const q = made.questions.map((x) => x.id);
    const answers = Object.fromEntries(q.map((id, i) => [`a:${id}`, `answer ${i}`]));
    const closed = (await redirected(() => submitForm(project, made.id, undefined, form({ label: "Closed", ...answers }))))
      .split("/").pop() as string;
    await saveDraft(project, closed, undefined, form({ label: "Closed", ...answers, intent: "close" }));
    const draft = (await redirected(() => submitForm(project, made.id, undefined, form({ label: "Draft", ...answers }))))
      .split("/").pop() as string;
    return { id: made.id, q, closed, draft };
  }

  async function review(id: string, rowsOfForm: Row[]): Promise<void> {
    const prisma = await prismaFor(project);
    const cl = await prisma.checklist.findUniqueOrThrow({ where: { id } });
    const fd = form({ title: cl.title, sourceId: cl.sourceId, controlTopic: cl.controlTopic });
    rowsOfForm.forEach((r, i) => {
      if (r.id) fd.set(`q.${i}.id`, r.id);
      fd.set(`q.${i}.text`, r.text);
    });
    fd.append("countryIds", countries[0].id);
    fd.append("regulationIds", regulations[0].id);
    expect(await redirected(() => saveReviewedQuestions(project, id, undefined, fd))).toBe(`/p/${project}/checklists`);
  }

  async function answersOf(submission: string): Promise<Record<string, string | null>> {
    const prisma = await prismaFor(project);
    const all = await prisma.submissionAnswer.findMany({ where: { submissionId: submission } });
    return Object.fromEntries(all.map((a) => [a.questionId, a.answer]));
  }

  async function questionsOf(id: string): Promise<{ id: string; order: number; text: string }[]> {
    const prisma = await prismaFor(project);
    return prisma.question.findMany({ where: { checklistId: id }, orderBy: { order: "asc" },
                                      select: { id: true, order: true, text: true } });
  }

  it("fixing a typo in one question keeps every answer, a closed submission's included", async () => {
    const { id, q, closed, draft } = await answered();
    await review(id, [{ id: q[0], text: "A?" }, { id: q[1], text: "B, reworded?" }, { id: q[2], text: "C?" }]);
    expect(await questionsOf(id)).toEqual([
      { id: q[0], order: 1, text: "A?" }, { id: q[1], order: 2, text: "B, reworded?" }, { id: q[2], order: 3, text: "C?" },
    ]);
    for (const sub of [closed, draft]) {
      expect(await answersOf(sub)).toEqual({ [q[0]]: "answer 0", [q[1]]: "answer 1", [q[2]]: "answer 2" });
    }
  });

  it("removing one question removes only its answers", async () => {
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[0], text: "A?" }, { id: q[2], text: "C?" }]);
    expect((await questionsOf(id)).map((x) => x.id)).toEqual([q[0], q[2]]);
    expect(await answersOf(closed)).toEqual({ [q[0]]: "answer 0", [q[2]]: "answer 2" });
  });

  it("adding a question and reordering keep every answer", async () => {
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[2], text: "C?" }, { id: q[0], text: "A?" }, { text: "New?" }, { id: q[1], text: "B?" }]);
    const now = await questionsOf(id);
    expect(now.map((x) => x.text)).toEqual(["C?", "A?", "New?", "B?"]);
    expect([now[0].id, now[1].id, now[3].id]).toEqual([q[2], q[0], q[1]]);
    expect(Object.keys(await answersOf(closed)).sort()).toEqual([...q].sort());
  });

  it("an id that is not one of the checklist's questions is a new question, never another checklist's", async () => {
    const other = await answered();
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[0], text: "A?" }, { id: q[1], text: "B?" }, { id: q[2], text: "C?" }, { id: other.q[0], text: "Stolen?" }]);
    const now = await questionsOf(id);
    expect(now).toHaveLength(4);
    expect(now[3].id).not.toBe(other.q[0]);
    expect(await answersOf(other.closed)).toEqual({ [other.q[0]]: "answer 0", [other.q[1]]: "answer 1", [other.q[2]]: "answer 2" });
    expect(Object.keys(await answersOf(closed)).sort()).toEqual([...q].sort());
  });

  it("the ledger says what was added, reworded and removed, and keeps only the answers removed", async () => {
    const { id, q, closed } = await answered();
    await review(id, [{ id: q[0], text: "A, reworded?" }, { id: q[1], text: "B?" }, { text: "D?" }]);
    const events = rows(
      `SELECT json_build_object('details', details, 'content', content) FROM ledger.outbox
         WHERE item_id = '${id}' AND action = 'controls.checklist.questions_revised'`, project,
    ).map((line) => JSON.parse(line) as { details: Record<string, unknown>; content: Record<string, unknown> });
    expect(events).toHaveLength(1);
    // C? was answered in the closed submission and in the draft: two answers go, one of them closed
    expect(events[0].details).toMatchObject({ questions: 3, added: 1, reworded: 1, removed: 1, answers_removed: 2,
                                              closed_answers_removed: 1 });
    const removed = (events[0].content as { removed_answers: { submission: string; question: string }[] }).removed_answers;
    expect(removed).toHaveLength(2);
    expect(removed.every((a) => a.question === q[2])).toBe(true);
    expect(removed).toContainEqual(expect.objectContaining({ submission: closed, question: q[2], status: "Closed" }));
  });
});
