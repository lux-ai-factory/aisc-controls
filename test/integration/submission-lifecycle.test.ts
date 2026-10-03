import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The server actions call Next's redirect()/revalidatePath(), which only work
// inside a request. They are mocked so the actions can be called directly and
// their effect on the database checked. redirect() is turned into a catchable throw that
// carries its target URL.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
}));

// These tests are about where the data goes, not who may put it there
// (test/integration/action-access.test.ts is): everybody is an editor.
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));

import { hasThrowawayDb, makeProject, su } from "./throwawayDb";
import { randomUUID } from "node:crypto";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import {
  saveDraft,
  reopenForAmendment,
  archiveSubmission,
  restoreSubmission,
} from "@/app/p/[project]/submissions/[id]/actions";

// Integration tests need a project database, made the way the platform makes
// one, and dropped afterwards. The SQL runs inside the throwaway Postgres
// container (see ./throwawayDb.ts), with its own env for the superuser role,
// so no password is handled here.
const hasDb = hasThrowawayDb;

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
  // Every answered checklist is answered for a project, so the lifecycle runs
  // inside one, made here and dropped afterwards.
  let project: string;

  beforeAll(async () => {
    project = makeProject();
    const prisma = await prismaFor(project);
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
  }, 60_000);

  afterAll(() => {
    su(`drop database if exists ${projectDatabaseName(project)} with (force)`);
  });

  it("submitForm creates a draft submission with answers and scores", async () => {
    const url = await captureRedirect(() =>
      submitForm(
        project,
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
    expect(url).toMatch(new RegExp(`^/p/${project}/submissions/.+`));

    const id = url.split("/").pop() as string;
    const prisma = await prismaFor(project);
    const sub = await prisma.submission.findUnique({
      where: { id },
      include: { answers: true },
    });
    expect(sub?.label).toBe("Run A");
    expect(sub?.status).toBe("Draft");

    const byQ = Object.fromEntries((sub?.answers ?? []).map((a) => [a.questionId, a]));
    expect(byQ[q1]).toMatchObject({ answer: "Yes", score: 4 });
    expect(byQ[q2]).toMatchObject({ answer: null, score: 2 });
  }, 30_000);

  it("saveDraft with intent=close closes the draft", async () => {
    const prisma = await prismaFor(project);
    const draft = await prisma.submission.create({
      data: { checklistId, label: "To close" },
    });

    const result = await saveDraft(
      project,
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
  }, 30_000);

  it("reopenForAmendment creates a new draft version that copies answers", async () => {
    const prisma = await prismaFor(project);
    const closed = await prisma.submission.create({
      data: {
        checklistId,
        label: "v1",
        status: "Closed",
        closedAt: new Date(),
        answers: { create: [{ questionId: q1, answer: "prev", score: 3 }] },
      },
    });

    const url = await captureRedirect(() => reopenForAmendment(project, closed.id));
    const newId = url.split("/").pop() as string;

    const next = await prisma.submission.findUnique({
      where: { id: newId },
      include: { answers: true },
    });
    expect(next?.status).toBe("Draft");
    expect(next?.version).toBe(2);
    expect(next?.previousVersionId).toBe(closed.id);
    expect(next?.answers[0]).toMatchObject({ answer: "prev", score: 3 });
  }, 30_000);

  it("archive then restore toggles archivedAt", async () => {
    const prisma = await prismaFor(project);
    const closed = await prisma.submission.create({
      data: {
        checklistId,
        label: "archive me",
        status: "Closed",
        closedAt: new Date(),
      },
    });

    await archiveSubmission(project, closed.id);
    expect(
      (await prisma.submission.findUnique({ where: { id: closed.id } }))?.archivedAt,
    ).not.toBeNull();

    await restoreSubmission(project, closed.id);
    expect(
      (await prisma.submission.findUnique({ where: { id: closed.id } }))?.archivedAt,
    ).toBeNull();
  }, 30_000);
});
