import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Isolation 2026-09-25 (01-specs.md I16.5, I2.5, I17.1, I6.1; risk 3): every controls route
// and action that addresses an object by id, opened under ANOTHER project's pid, is "not found"
// (the id is not in that project's database), and the owning project still reaches it.
//
// Controls is already one database per project (plan 1), so the cross-project cases are
// expected GREEN guards: they pin that isolation keeps holding. project-scope.test.ts covers
// some of the same actions but runs its SQL in the live `postgres` container, so it is never
// run by the isolation pipeline; this file is the throwaway-only version, covering every route.
//
// The dropped-database cases (I2.5) are expected RED until a dropped project answers 404.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts). Who may write is mocked:
// everybody is an editor, so every refusal below comes from the database, not the door.
//
// Route inventory (src/app, 2026-09-25), every one addressed by an id:
//   page   /p/[project]/checklists/[id]/fill          FillPage
//   action /p/[project]/checklists/[id]/fill          submitForm(project, checklistId)
//   page   /p/[project]/checklists/[id]/review        ReviewPage
//   action /p/[project]/checklists/[id]/review        saveReviewedQuestions(project, checklistId)
//   page   /p/[project]/submissions/[id]              SubmissionPage (via submissionOfProject)
//   route  /p/[project]/submissions/[id]/report       GET (PDF)
//   action /p/[project]/submissions/[id]              saveDraft, reopenForAmendment,
//                                                     archiveSubmission, restoreSubmission
// Not by id (not in scope here): /, /install, /api/install, /p/[project], checklists list,
// sources list and new, submissions list and archived, install actions (by catalogue slug).

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
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));

import { randomUUID } from "node:crypto";

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { hasThrowawayDb, makeProject, dropProject } from "./throwawayDb";

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

const params = (project: string, id: string) => ({ params: Promise.resolve({ project, id }) });

describe.skipIf(!hasThrowawayDb)("I16.5: a controls id opened under another project's pid is not found", () => {
  let mine: string;
  let theirs: string;
  let theirChecklist: string;
  let theirQuestion: string;
  let theirSubmission: string;

  beforeAll(async () => {
    // No platform: the latest card version is "none", answers are saved unstamped.
    process.env.PLATFORM_URL = "";
    mine = makeProject();
    theirs = makeProject();
    const tag = randomUUID().slice(0, 8);
    await prismaFor(mine);
    const prisma = await prismaFor(theirs);
    const source = await prisma.source.create({ data: { name: `Iso ${tag}`, slug: `iso-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: {
        title: `Iso ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "Q1?" }] },
      },
      include: { questions: true },
    });
    theirChecklist = checklist.id;
    theirQuestion = checklist.questions[0].id;
    const { submitForm } = await import("@/app/p/[project]/checklists/[id]/fill/actions");
    const url = await captureRedirect(() =>
      submitForm(theirs, theirChecklist, undefined, form({ label: "Theirs", [`a:${theirQuestion}`]: "Yes" })),
    );
    theirSubmission = url.split("/").pop() as string;
  }, 180_000);

  afterAll(async () => {
    await closeProjectDatabases();
    for (const pid of [mine, theirs]) if (pid) dropProject(pid);
  });

  it("I16.5 fill page: another project's checklist is not found, the owner's renders", async () => {
    const { default: FillPage } = await import("@/app/p/[project]/checklists/[id]/fill/page");
    const search = { searchParams: Promise.resolve({}) };
    await expect(FillPage({ ...params(mine, theirChecklist), ...search })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(FillPage({ ...params(theirs, theirChecklist), ...search })).resolves.toBeTruthy();
  }, 60_000);

  it("I16.5 fill action: submitting another project's checklist creates nothing anywhere", async () => {
    const { submitForm } = await import("@/app/p/[project]/checklists/[id]/fill/actions");
    const theirsBefore = await (await prismaFor(theirs)).submission.count();
    const state = await submitForm(mine, theirChecklist, undefined, form({ label: "Hijack", [`a:${theirQuestion}`]: "No" }));
    expect(state).toEqual({ error: "Checklist not found." });
    expect(await (await prismaFor(mine)).submission.count()).toBe(0);
    expect(await (await prismaFor(theirs)).submission.count()).toBe(theirsBefore);
  }, 60_000);

  it("I16.5 review page: another project's checklist is not found, the owner's renders", async () => {
    const { default: ReviewPage } = await import("@/app/p/[project]/checklists/[id]/review/page");
    await expect(ReviewPage(params(mine, theirChecklist))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ReviewPage(params(theirs, theirChecklist))).resolves.toBeTruthy();
  }, 60_000);

  it("I16.5 review action: another project's checklist cannot be edited", async () => {
    const { saveReviewedQuestions } = await import("@/app/p/[project]/checklists/[id]/review/actions");
    const before = await (await prismaFor(theirs)).checklist.findUnique({ where: { id: theirChecklist } });
    const state = await saveReviewedQuestions(mine, theirChecklist, undefined, form({ title: "Hijacked" }));
    expect(state).toEqual({ error: "Checklist not found." });
    const after = await (await prismaFor(theirs)).checklist.findUnique({ where: { id: theirChecklist } });
    expect(after?.title).toBe(before?.title);
  }, 60_000);

  it("I16.5 submission page: another project's submission is not found, the owner's renders", async () => {
    const { default: SubmissionPage } = await import("@/app/p/[project]/submissions/[id]/page");
    const { submissionOfProject } = await import("@/lib/submissions");
    expect(await submissionOfProject(mine, theirSubmission)).toBeNull();
    expect(await submissionOfProject(theirs, theirSubmission)).not.toBeNull();
    await expect(SubmissionPage(params(mine, theirSubmission) as never)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(SubmissionPage(params(theirs, theirSubmission) as never)).resolves.toBeTruthy();
  }, 60_000);

  it("I16.5 report route: another project's submission is not found before any renderer call", async () => {
    const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(GET(new Request("http://x/"), params(mine, theirSubmission))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  }, 60_000);

  it("I16.5 submission actions: draft, reopen, archive, restore of another project's submission change nothing", async () => {
    const { saveDraft, reopenForAmendment, archiveSubmission, restoreSubmission } = await import(
      "@/app/p/[project]/submissions/[id]/actions"
    );
    const prisma = await prismaFor(theirs);
    const before = await prisma.submission.findUnique({ where: { id: theirSubmission }, include: { answers: true } });
    const countBefore = await prisma.submission.count();

    const state = await saveDraft(mine, theirSubmission, undefined, form({ label: "hijacked" }));
    expect(state).toBeTruthy();
    await expect(reopenForAmendment(mine, theirSubmission)).rejects.toThrow();
    await expect(archiveSubmission(mine, theirSubmission)).rejects.toThrow();
    await expect(restoreSubmission(mine, theirSubmission)).rejects.toThrow();

    const after = await prisma.submission.findUnique({ where: { id: theirSubmission }, include: { answers: true } });
    expect(after?.label).toBe(before?.label);
    expect(after?.archivedAt).toEqual(before?.archivedAt);
    expect(after?.answers.map((a) => a.answer)).toEqual(before?.answers.map((a) => a.answer));
    expect(await prisma.submission.count()).toBe(countBefore);
    expect(await (await prismaFor(mine)).submission.count()).toBe(0);
  }, 60_000);
});

describe.skipIf(!hasThrowawayDb)("I2.5 / I17.1: a project whose database was dropped answers 404, not 500", () => {
  afterAll(async () => {
    await closeProjectDatabases();
  });

  it("I2.5: an open client whose database is dropped is evicted, and the pid is not found", async () => {
    const pid = makeProject();
    const { submissionOfProject } = await import("@/lib/submissions");
    const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
    expect(await submissionOfProject(pid, "nope")).toBeNull(); // opens and migrates the client
    dropProject(pid); // the platform deletes the project
    // First request after the drop: the pooled client hits "database does not exist".
    await expect(GET(new Request("http://x/"), params(pid, "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    // Second request: the client was evicted; opening again must still be "not found".
    await expect(submissionOfProject(pid, "nope")).rejects.toThrow("NEXT_NOT_FOUND");
  }, 120_000);

  it("I2.5: a pid whose database never existed is not found (no migration error leaks as a 500)", async () => {
    const { submissionOfProject } = await import("@/lib/submissions");
    await expect(submissionOfProject(randomUUID(), "nope")).rejects.toThrow("NEXT_NOT_FOUND");
  }, 120_000);
});
