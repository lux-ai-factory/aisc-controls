import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The server actions call Next's redirect()/revalidatePath(), which only work
// inside a request. Mock them so we can drive the actions directly and assert
// the database side effects. redirect() is turned into a catchable throw that
// carries its target URL.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
}));

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { submitForm } from "@/app/checklists/[id]/fill/actions";
import {
  saveDraft,
  reopenForAmendment,
  archiveSubmission,
  restoreSubmission,
} from "@/app/submissions/[id]/actions";

// Integration tests need a database. They run against DATABASE_URL (the dev DB
// locally, a throwaway Postgres in CI) and clean up everything they create, so
// they never touch seeded data. Skipped when no DATABASE_URL is set.
const hasDb = Boolean(process.env.DATABASE_URL);

async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) {
      return (err as { redirectUrl: string }).redirectUrl;
    }
    throw err;
  }
  throw new Error("expected a redirect, but none was thrown");
}

function field(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

describe.skipIf(!hasDb)("submission lifecycle (integration)", () => {
  let sourceId: string;
  let checklistId: string;
  let q1: string;
  let q2: string;

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({
      data: { name: `Test Source ${tag}`, slug: `test-source-${tag}` },
    });
    sourceId = source.id;

    const checklist = await prisma.checklist.create({
      data: {
        title: `Test Checklist ${tag}`,
        sourceId,
        controlTopic: "Testing",
        countryIds: ["EU"],
        regulationIds: ["ai-act"],
        questions: {
          create: [
            { order: 1, text: "Q1?" },
            { order: 2, text: "Q2?" },
          ],
        },
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    checklistId = checklist.id;
    q1 = checklist.questions[0].id;
    q2 = checklist.questions[1].id;
  });

  afterAll(async () => {
    // Deleting the checklist cascades to its questions, submissions, and answers.
    if (checklistId) await prisma.checklist.deleteMany({ where: { id: checklistId } });
    if (sourceId) await prisma.source.deleteMany({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  it("submitForm creates a draft submission with answers and scores", async () => {
    const url = await captureRedirect(() =>
      submitForm(
        checklistId,
        undefined,
        field({
          label: "Run A",
          [`a:${q1}`]: "Yes",
          [`s:${q1}`]: "4",
          [`s:${q2}`]: "2",
        }),
      ),
    );
    expect(url).toMatch(/^\/submissions\/.+/);

    const id = url.split("/").pop() as string;
    const sub = await prisma.submission.findUnique({
      where: { id },
      include: { answers: true },
    });
    expect(sub?.label).toBe("Run A");
    expect(sub?.status).toBe("Draft");

    const byQ = Object.fromEntries((sub?.answers ?? []).map((a) => [a.questionId, a]));
    expect(byQ[q1]).toMatchObject({ answer: "Yes", score: 4 });
    expect(byQ[q2]).toMatchObject({ answer: null, score: 2 });
  });

  it("saveDraft with intent=close closes the draft", async () => {
    const draft = await prisma.submission.create({
      data: { checklistId, label: "To close" },
    });

    const result = await saveDraft(
      draft.id,
      undefined,
      field({
        label: "Closed run",
        intent: "close",
        [`a:${q1}`]: "Done",
        [`s:${q1}`]: "5",
      }),
    );
    expect(result).toBeUndefined(); // no error returned

    const updated = await prisma.submission.findUnique({
      where: { id: draft.id },
      include: { answers: true },
    });
    expect(updated?.status).toBe("Closed");
    expect(updated?.closedAt).not.toBeNull();
    expect(updated?.label).toBe("Closed run");
    expect(updated?.answers).toHaveLength(1);
  });

  it("reopenForAmendment creates a new draft version that copies answers", async () => {
    const closed = await prisma.submission.create({
      data: {
        checklistId,
        label: "v1",
        status: "Closed",
        closedAt: new Date(),
        answers: { create: [{ questionId: q1, answer: "prev", score: 3 }] },
      },
    });

    const url = await captureRedirect(() => reopenForAmendment(closed.id));
    const newId = url.split("/").pop() as string;

    const next = await prisma.submission.findUnique({
      where: { id: newId },
      include: { answers: true },
    });
    expect(next?.status).toBe("Draft");
    expect(next?.version).toBe(2);
    expect(next?.previousVersionId).toBe(closed.id);
    expect(next?.answers[0]).toMatchObject({ answer: "prev", score: 3 });
  });

  it("archive then restore toggles archivedAt", async () => {
    const closed = await prisma.submission.create({
      data: {
        checklistId,
        label: "archive me",
        status: "Closed",
        closedAt: new Date(),
      },
    });

    await archiveSubmission(closed.id);
    expect(
      (await prisma.submission.findUnique({ where: { id: closed.id } }))?.archivedAt,
    ).not.toBeNull();

    await restoreSubmission(closed.id);
    expect(
      (await prisma.submission.findUnique({ where: { id: closed.id } }))?.archivedAt,
    ).toBeNull();
  });
});
