import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Every server action checks, itself, that the caller may change the project
// it was *told* to change. The middleware checks only the project in the URL,
// and an action's bound arguments come from the client: a viewer of A who
// owns B could post to /p/B/... with [A, ...] bound and write into A.
//
// The platform is not called: fetchAccess is replaced by a lookup in `roles`,
// keyed by pid, and decide() stays the real one. The writes are observed in a
// real throwaway project database.
const h = vi.hoisted(() => ({
  roles: new Map<string, { role: string | null; may_write: boolean } | "down">(),
  pkg: {
    meta: { catalogueId: "access-probe", title: "Access probe", sourceName: "AESIA", controlTopic: "Accuracy" },
    questions: [{ text: "installed?" }],
  },
}));

vi.mock("@/lib/access/projectAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/projectAccess")>();
  return {
    ...actual,
    fetchAccess: vi.fn(async (pid: string) => {
      const found = h.roles.get(pid);
      if (found === "down") return null;
      return { admin: false, ...(found ?? { role: null, may_write: false }) };
    }),
  };
});
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));
vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: vi.fn(async () => ({ ok: true, pkg: h.pkg })),
}));
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

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { countries, regulations } from "@/data";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { installFromCatalogue } from "@/app/p/[project]/install/actions";
import { saveReviewedQuestions } from "@/app/p/[project]/checklists/[id]/review/actions";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { createSource } from "@/app/p/[project]/sources/new/actions";
import {
  saveDraft,
  reopenForAmendment,
  archiveSubmission,
  restoreSubmission,
} from "@/app/p/[project]/submissions/[id]/actions";

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

function field(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}

/** What the call ended in: a returned state, a redirect, a 404, or an error. */
async function outcome(fn: () => Promise<unknown>) {
  try {
    return { returned: await fn() };
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) {
      return { redirect: (err as { redirectUrl: string }).redirectUrl };
    }
    if ((err as Error).message === "NEXT_NOT_FOUND") return { notFound: true };
    return { threw: (err as Error).message };
  }
}

const READ_ONLY = "You can read this project but not change it.";

describe.skipIf(!hasDb)("a server action checks the project it is told to change", () => {
  let victim: string;
  let checklistId: string;
  let sourceId: string;
  let draftId: string;
  let closedId: string;
  let archivedId: string;

  /** Everything the actions below could touch, so "nothing written" is one comparison. */
  async function snapshot() {
    const db = await prismaFor(victim);
    return {
      checklists: await db.checklist.count(),
      sources: await db.source.count(),
      submissions: await db.submission.count(),
      questions: (await db.question.findMany({ where: { checklistId }, orderBy: { order: "asc" } })).map((q) => q.text),
      draftLabel: (await db.submission.findUniqueOrThrow({ where: { id: draftId } })).label,
      closedArchived: (await db.submission.findUniqueOrThrow({ where: { id: closedId } })).archivedAt,
      archivedArchived: (await db.submission.findUniqueOrThrow({ where: { id: archivedId } })).archivedAt,
    };
  }

  const reviewForm = () =>
    field({
      title: "Retitled",
      sourceId,
      controlTopic: "Testing",
      countryIds: countries[0].id,
      regulationIds: regulations[0].id,
      "q.0.text": "rewritten",
    });

  // Every action, called with the victim's pid bound, as an attacker would.
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["installFromCatalogue", () => installFromCatalogue(victim, "access-probe", undefined)],
    ["saveReviewedQuestions", () => saveReviewedQuestions(victim, checklistId, undefined, reviewForm())],
    ["submitForm", () => submitForm(victim, checklistId, undefined, field({ label: "planted" }))],
    ["createSource", () => createSource(victim, undefined, field({ name: `Planted ${randomUUID()}` }))],
    ["saveDraft", () => saveDraft(victim, draftId, undefined, field({ label: "hijacked" }))],
    ["reopenForAmendment", () => reopenForAmendment(victim, closedId)],
    ["archiveSubmission", () => archiveSubmission(victim, closedId)],
    ["restoreSubmission", () => restoreSubmission(victim, archivedId)],
  ];

  beforeAll(async () => {
    victim = makeProject();
    const db = await prismaFor(victim);
    const source = await db.source.create({ data: { name: "Victim source", slug: "victim-source" } });
    sourceId = source.id;
    const checklist = await db.checklist.create({
      data: {
        title: "Victim checklist",
        sourceId,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "original" }] },
      },
      include: { questions: true },
    });
    checklistId = checklist.id;
    draftId = (await db.submission.create({ data: { checklistId, label: "draft" } })).id;
    closedId = (await db.submission.create({ data: { checklistId, label: "closed", status: "Closed", closedAt: new Date() } })).id;
    archivedId = (
      await db.submission.create({
        data: { checklistId, label: "archived", status: "Closed", closedAt: new Date(), archivedAt: new Date() },
      })
    ).id;
  }, 60_000);

  afterAll(() => {
    su(`drop database if exists ${projectDatabaseName(victim)} with (force)`);
  });

  describe("somebody who is not in the project", () => {
    it.each(calls)("%s writes nothing and says there is no such project", async (_name, call) => {
      h.roles.delete(victim);
      const before = await snapshot();
      expect(await outcome(call)).toEqual({ notFound: true });
      expect(await snapshot()).toEqual(before);
    }, 30_000);
  });

  describe("a viewer of the project", () => {
    it.each(calls)("%s writes nothing and is refused", async (_name, call) => {
      h.roles.set(victim, { role: "viewer", may_write: false });
      const before = await snapshot();
      const result = await outcome(call);
      if ("returned" in result) expect(result.returned).toEqual({ error: READ_ONLY });
      else expect(result).toEqual({ threw: READ_ONLY });
      expect(await snapshot()).toEqual(before);
    }, 30_000);
  });

  describe("while the platform is not answering", () => {
    it.each(calls)("%s writes nothing", async (_name, call) => {
      h.roles.set(victim, "down");
      const before = await snapshot();
      const result = await outcome(call);
      expect(result).not.toHaveProperty("redirect");
      expect(result).not.toEqual({ returned: undefined });
      expect(await snapshot()).toEqual(before);
    }, 30_000);
  });

  it("a slug that is not a pid is not found, not a crash", async () => {
    expect(await outcome(() => submitForm("not-a-pid", checklistId, undefined, field({ label: "x" })))).toEqual({
      notFound: true,
    });
  });

  describe("an editor of the project", () => {
    it("installs", async () => {
      h.roles.set(victim, { role: "editor", may_write: true });
      const result = await outcome(calls[0][1]);
      expect(result.redirect).toMatch(new RegExp(`^/p/${victim}/checklists/[^/]+/fill\\?installed=new$`));
      expect((await snapshot()).checklists).toBe(2);
    }, 60_000);

    it("reviews, and lands back on this project's checklists", async () => {
      h.roles.set(victim, { role: "editor", may_write: true });
      expect(await outcome(calls[1][1])).toEqual({ redirect: `/p/${victim}/checklists` });
      expect((await snapshot()).questions).toEqual(["rewritten"]);
    }, 30_000);

    it("answers, adds a source, saves a draft", async () => {
      h.roles.set(victim, { role: "editor", may_write: true });
      const before = await snapshot();
      expect((await outcome(calls[2][1])).redirect).toMatch(`/p/${victim}/submissions/`);
      expect((await outcome(calls[3][1])).redirect).toBe(`/p/${victim}/sources`);
      expect(await outcome(calls[4][1])).toEqual({ returned: undefined });
      const after = await snapshot();
      expect(after.submissions).toBe(before.submissions + 1);
      expect(after.sources).toBe(before.sources + 1);
      expect(after.draftLabel).toBe("hijacked");
    }, 30_000);

    it("reopens, archives and restores", async () => {
      h.roles.set(victim, { role: "editor", may_write: true });
      const before = await snapshot();
      expect((await outcome(calls[5][1])).redirect).toMatch(`/p/${victim}/submissions/`);
      expect(await outcome(calls[6][1])).toEqual({ returned: undefined });
      expect(await outcome(calls[7][1])).toEqual({ returned: undefined });
      const after = await snapshot();
      expect(after.submissions).toBe(before.submissions + 1);
      expect(after.closedArchived).not.toBeNull();
      expect(after.archivedArchived).toBeNull();
    }, 30_000);
  });
});
