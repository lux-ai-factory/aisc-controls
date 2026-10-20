import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
  // As Next's notFound(): it throws, so a 404 path cannot fall through to a missing-export error.
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// These tests are about where the data goes, not who may put it there
// (test/integration/action-access.test.ts is): everybody is an editor.
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: false, mayWrite: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  callerToken: async () => "caller-token",
}));

import { hasThrowawayDb, makeProject, su } from "./throwawayDb";
import { randomUUID } from "node:crypto";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { submissionsOfProject } from "@/lib/submissions";

// Every project has its own database, made the way the platform makes them,
// and dropped afterwards. The SQL runs inside the throwaway Postgres container
// (see ./throwawayDb.ts), with its own env for the superuser role, so no
// password is handled here.
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

describe.skipIf(!hasDb)("a submission belongs to a project", () => {
  let project: string;
  let otherProject: string;
  let checklistId: string;
  let otherChecklistId: string;
  let q1: string;

  beforeAll(async () => {
    project = makeProject();
    otherProject = makeProject();
    const tag = randomUUID().slice(0, 8);

    const prisma = await prismaFor(project);
    const source = await prisma.source.create({
      data: { name: `Scope Source ${tag}`, slug: `scope-source-${tag}` },
    });
    const checklist = await prisma.checklist.create({
      data: {
        title: `Scope Checklist ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "Q1?" }] },
      },
      include: { questions: true },
    });
    checklistId = checklist.id;
    q1 = checklist.questions[0].id;

    const otherPrisma = await prismaFor(otherProject);
    const otherSource = await otherPrisma.source.create({
      data: { name: `Scope Source Other ${tag}`, slug: `scope-source-other-${tag}` },
    });
    const otherChecklist = await otherPrisma.checklist.create({
      data: {
        title: `Scope Checklist Other ${tag}`,
        sourceId: otherSource.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "Q1?" }] },
      },
    });
    otherChecklistId = otherChecklist.id;
  }, 60_000);

  afterAll(() => {
    for (const pid of [project, otherProject]) su(`drop database if exists ${projectDatabaseName(pid)} with (force)`);
  });

  it("keeps the answers in that project's database, not the other's", async () => {
    const url = await captureRedirect(() =>
      submitForm(project, checklistId, undefined, field({ label: "For this project", [`a:${q1}`]: "Yes" })),
    );
    const id = url.split("/").pop() as string;
    const sub = await (await prismaFor(project)).submission.findUnique({ where: { id }, include: { answers: true } });
    expect(sub?.answers.map((a) => a.answer)).toEqual(["Yes"]);
    expect(await (await prismaFor(otherProject)).submission.findUnique({ where: { id } })).toBeNull();
    // and the page it redirects to stays inside that project
    expect(url).toBe(`/p/${project}/submissions/${id}`);
  }, 30_000);

  it("lists one project's answers and not another's", async () => {
    await captureRedirect(() =>
      submitForm(project, checklistId, undefined, field({ label: "Mine" })),
    );
    await captureRedirect(() =>
      submitForm(otherProject, otherChecklistId, undefined, field({ label: "Theirs" })),
    );

    const labels = (await submissionsOfProject(project)).map((s) => s.label);
    expect(labels).toContain("Mine");
    expect(labels).not.toContain("Theirs");
  }, 30_000);
});
