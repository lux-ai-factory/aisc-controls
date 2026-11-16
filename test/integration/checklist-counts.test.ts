import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";

// The counts on the checklist and submission cards are the ones the Submissions page lists: a checklist
// counts its current submissions (not every version, not the archived ones), and a submission counts the
// questions it answered, not the answer rows (a row may hold only a proof file).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: false, mayWrite: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "caller-token" }));

import { hasThrowawayDb, makeProject, su } from "./throwawayDb";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submissionsOfProject } from "@/lib/submissions";
import LibraryPage from "@/app/p/[project]/checklists/page";
import SubmissionsPage from "@/app/p/[project]/submissions/page";
import ArchivedSubmissionsPage from "@/app/p/[project]/submissions/archived/page";

describe.skipIf(!hasThrowawayDb)("counts on the checklist and submission cards", () => {
  let project: string;
  let checklistTitle: string;

  beforeAll(async () => {
    project = makeProject();
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `Source ${tag}`, slug: `source-${tag}` } });
    checklistTitle = `Fundamental rights ${tag}`;
    const checklist = await prisma.checklist.create({
      data: {
        title: checklistTitle,
        sourceId: source.id,
        controlTopic: "Rights",
        questions: { create: [{ order: 1, text: "First?" }, { order: 2, text: "Second?" }] },
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    const [q1, q2] = checklist.questions;
    const closed = { status: "Closed" as const, closedAt: new Date() };

    // One submission amended once (two versions, one listed), and one answered once.
    const first = await prisma.submission.create({
      data: { checklistId: checklist.id, label: "Provider review", version: 1, ...closed },
    });
    await prisma.submission.create({
      data: {
        checklistId: checklist.id, label: "Provider review", version: 2, previousVersionId: first.id, ...closed,
      },
    });
    const other = await prisma.submission.create({
      data: { checklistId: checklist.id, label: "Deployer review", version: 1, ...closed },
    });
    // One real answer, and one row that holds nothing but (would hold) a proof file.
    await prisma.submissionAnswer.createMany({
      data: [
        { submissionId: other.id, questionId: q1.id, answer: "Yes, documented.", score: 4 },
        { submissionId: other.id, questionId: q2.id, answer: null, score: null },
      ],
    });
    // The same in the archive: one answer, one row with nothing in it.
    const archived = await prisma.submission.create({
      data: { checklistId: checklist.id, label: "Archived review", version: 1, ...closed, archivedAt: new Date() },
    });
    await prisma.submissionAnswer.createMany({
      data: [
        { submissionId: archived.id, questionId: q1.id, answer: "Yes.", score: 3 },
        { submissionId: archived.id, questionId: q2.id, answer: null, score: null },
      ],
    });
  }, 60_000);

  afterAll(() => {
    su(`drop database if exists ${projectDatabaseName(project)} with (force)`);
  });

  it("a checklist card counts the submissions the Submissions page lists", async () => {
    const listed = (await submissionsOfProject(project)).length;
    expect(listed).toBe(2);
    const html = renderToStaticMarkup(
      await LibraryPage({ params: Promise.resolve({ project }), searchParams: Promise.resolve({}) }),
    );
    const counts = html.match(/(\d+) submissions/)?.[1];
    expect(counts, `the card says '${html.match(/\d+ questions · [^<]*/)?.[0]}'`).toBe(String(listed));
  }, 30_000);

  it("a submission card counts the questions answered, not the answer rows", async () => {
    const html = renderToStaticMarkup(
      await SubmissionsPage({ params: Promise.resolve({ project }), searchParams: Promise.resolve({}) }),
    );
    const card = html.match(/Deployer review[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(card, "the deployer's card").not.toBe("");
    expect(card.match(/(\d+) answers?\b/)?.[1], "one question has an answer; the other row holds no answer").toBe("1");
  }, 30_000);

  it("an archived submission's card counts the questions answered, not the answer rows", async () => {
    const html = renderToStaticMarkup(await ArchivedSubmissionsPage({ params: Promise.resolve({ project }) }));
    const card = html.match(/Archived review[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(card, "the archived card").not.toBe("");
    expect(card.match(/(\d+) answers?\b/)?.[1], "one question has an answer; the other row holds no answer").toBe("1");
  }, 30_000);
});
