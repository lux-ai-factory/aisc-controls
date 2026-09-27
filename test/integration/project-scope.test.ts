import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { submissionsOfProject } from "@/lib/submissions";

// Every project has its own database, made the way the platform makes them,
// and dropped afterwards. The SQL runs inside the postgres container, using
// its own env for the superuser role, so no password is handled here.
const hasDb = Boolean(process.env.PROJECT_DATABASE_URL);
const su = (sql: string, db = "platform") =>
  execSync(`docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -Atc "${sql}"'`);

function makeProject(): string {
  const pid = randomUUID();
  const db = projectDatabaseName(pid);
  su(`create database ${db}`);
  su(`grant connect on database ${db} to controls_rw`, db);
  su(`create schema controls; grant usage, create on schema controls to controls_rw`, db);
  return pid;
}

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

  it("a submission through a pid with no database fails", async () => {
    await expect(
      submitForm(randomUUID(), checklistId, undefined, field({ label: "Nobody's" })),
    ).rejects.toThrow();
  }, 30_000);
});

// A project's answers are not readable, or writable, from inside another
// project just by knowing an id.
//
// The listing above was scoped from the start. What was not: every lookup that
// takes a submission id straight out of the URL. The door checks that you are
// in the project named in the path; these functions run against that
// project's own database, so an id from another project's database is simply
// not there to find.
describe.skipIf(!hasDb)("one project cannot reach into another by id", () => {
  let mine: string;
  let theirs: string;
  let checklistId: string;
  let theirSubmission: string;

  beforeAll(async () => {
    mine = makeProject();
    theirs = makeProject();
    const tag = randomUUID().slice(0, 8);

    const theirPrisma = await prismaFor(theirs);
    const source = await theirPrisma.source.create({
      data: { name: `Idor Source ${tag}`, slug: `idor-source-${tag}` },
    });
    const checklist = await theirPrisma.checklist.create({
      data: {
        title: `Idor Checklist ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "Q1?" }] },
      },
    });
    checklistId = checklist.id;

    const theirUrl = await captureRedirect(() =>
      submitForm(theirs, checklistId, undefined, field({ label: "Not yours" })),
    );
    theirSubmission = theirUrl.split("/").pop() as string;
  }, 60_000);

  afterAll(() => {
    for (const pid of [mine, theirs]) su(`drop database if exists ${projectDatabaseName(pid)} with (force)`);
  });

  it("does not load another project's submission", async () => {
    const { submissionOfProject } = await import("@/lib/submissions");
    expect(await submissionOfProject(theirs, theirSubmission)).not.toBeNull();
    expect(await submissionOfProject(mine, theirSubmission)).toBeNull();
  }, 30_000);

  it("does not archive another project's submission", async () => {
    const { archiveSubmission } = await import("@/app/p/[project]/submissions/[id]/actions");
    await expect(archiveSubmission(mine, theirSubmission)).rejects.toThrow();
    const theirPrisma = await prismaFor(theirs);
    const after = await theirPrisma.submission.findUnique({ where: { id: theirSubmission } });
    expect(after?.archivedAt).toBeNull();
  }, 30_000);

  it("does not reopen another project's submission", async () => {
    const { reopenForAmendment } = await import("@/app/p/[project]/submissions/[id]/actions");
    await expect(reopenForAmendment(mine, theirSubmission)).rejects.toThrow();
    const theirPrisma = await prismaFor(theirs);
    const versions = await theirPrisma.submission.count({ where: { checklistId } });
    expect(versions).toBe(1);
  }, 30_000);

  it("does not restore another project's submission", async () => {
    const { restoreSubmission } = await import("@/app/p/[project]/submissions/[id]/actions");
    await expect(restoreSubmission(mine, theirSubmission)).rejects.toThrow();
  }, 30_000);

  it("does not save a draft into another project's submission", async () => {
    const { saveDraft } = await import("@/app/p/[project]/submissions/[id]/actions");
    const theirPrisma = await prismaFor(theirs);
    const before = await theirPrisma.submission.findUnique({ where: { id: theirSubmission } });
    const state = await saveDraft(mine, theirSubmission, undefined, field({ label: "hijacked" }));
    const after = await theirPrisma.submission.findUnique({ where: { id: theirSubmission } });
    expect(after?.label).toBe(before?.label);
    expect(state).toBeTruthy();
  }, 30_000);

  it("still lets the project that owns it do all of that", async () => {
    const { archiveSubmission, restoreSubmission, saveDraft } =
      await import("@/app/p/[project]/submissions/[id]/actions");
    const theirPrisma = await prismaFor(theirs);
    // Only a closed sheet can be archived, so close it the way the page does.
    await saveDraft(theirs, theirSubmission, undefined, field({ label: "Not yours", intent: "close" }));
    await archiveSubmission(theirs, theirSubmission);
    expect((await theirPrisma.submission.findUnique({ where: { id: theirSubmission } }))?.archivedAt)
      .not.toBeNull();
    await restoreSubmission(theirs, theirSubmission);
    expect((await theirPrisma.submission.findUnique({ where: { id: theirSubmission } }))?.archivedAt)
      .toBeNull();
  }, 30_000);
});
