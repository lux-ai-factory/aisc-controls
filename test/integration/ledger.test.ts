import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Ledger phase 7 (K1-K3) against a project database made the platform's way (its template has
// ledger.emit, 0020): every controls write records its event in the change's own transaction, a
// failure after the event leaves neither, and a question review's event keeps what the review deletes
// (the old questions, and every answer removed, closed submissions' too). Throwaway Postgres only.

const state = vi.hoisted(() => ({ request: "", failAfter: "" }));
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
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-aisc-request-id": state.request }) }));
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => null }));
vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async (slug: string) => ({
    ok: true,
    pkg: { meta: { catalogueId: slug, title: `Control ${slug}`, sourceName: `Src ${slug}`, controlTopic: "T" },
           questions: [{ text: "Is it logged?" }, { text: "Is it reviewed?" }] },
  }),
}));
// the real emitter; a test can make the change fail right after a given event
vi.mock("@/lib/ledger/emit", async (orig) => {
  const real = await orig<typeof import("@/lib/ledger/emit")>();
  return {
    ...real,
    emitEvent: async (tx: never, event: { action: string }) => {
      const id = await real.emitEvent(tx, event as never);
      if (state.failAfter && state.failAfter === event.action) {
        state.failAfter = "";
        throw new Error("a failure right after the event (test)");
      }
      return id;
    },
  };
});

import { randomUUID } from "node:crypto";

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { saveReviewedQuestions } from "@/app/p/[project]/checklists/[id]/review/actions";
import { saveDraft, reopenForAmendment, archiveSubmission, restoreSubmission } from "@/app/p/[project]/submissions/[id]/actions";
import { createSource } from "@/app/p/[project]/sources/new/actions";
import { installHere } from "@/app/p/[project]/catalogue/actions";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";
import { countries, regulations } from "@/data";

const REQUEST = "a7a7a7a7-0000-4000-8000-000000000001";

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

type Row = { action: string; item_id: string; db_role: string; request_id: string; details: Record<string, unknown>;
  content: Record<string, unknown> | null; before: Record<string, unknown> | null };

describe.skipIf(!hasThrowawayDb)("ledger phase 7: every controls write records its event", () => {
  let project: string;
  let checklistId: string;
  let qA: string;

  function outbox(item?: string): Row[] {
    return rows(
      `SELECT json_build_object('action', action, 'item_id', item_id, 'db_role', db_role, 'request_id', request_id,
              'details', details, 'content', content, 'before', before)
         FROM ledger.outbox ${item ? `WHERE item_id = '${item}'` : ""} ORDER BY occurred_at, event_id`,
      project,
    ).map((line) => JSON.parse(line) as Row);
  }

  beforeAll(async () => {
    project = makeProject();
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "Testing",
              questions: { create: [{ order: 1, text: "A?" }, { order: 2, text: "B?" }] } },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    checklistId = checklist.id;
    qA = checklist.questions[0].id;
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  beforeEach(() => {
    vi.stubEnv("LEDGER_MODE", "record");
    state.request = REQUEST;
    state.failAfter = "";
  });

  it("a submission's life: created, saved, closed, reopened, archived, restored", async () => {
    const to = await redirected(() => submitForm(project, checklistId, undefined, form({ label: "Run 1", [`a:${qA}`]: "yes" })));
    const id = to.split("/").pop() as string;
    await saveDraft(project, id, undefined, form({ label: "Run 1", [`a:${qA}`]: "no" }));
    await saveDraft(project, id, undefined, form({ label: "Run 1", [`a:${qA}`]: "no", intent: "close" }));
    await archiveSubmission(project, id);
    await restoreSubmission(project, id);
    await restoreSubmission(project, id);                              // not archived any more: nothing
    const next = (await redirected(() => reopenForAmendment(project, id))).split("/").pop();
    const mine = outbox(id);
    expect(mine.map((r) => r.action)).toEqual(["controls.submission.created", "controls.submission.draft_saved",
      "controls.submission.closed", "controls.submission.archived", "controls.submission.restored",
      "controls.submission.reopened"]);
    for (const r of mine) expect([r.db_role, r.request_id]).toEqual(["controls_rw", REQUEST]);
    expect(mine[5].details).toMatchObject({ next, version: 2 });
    // what a save overwrites is its event's before (the ledger keeps it)
    expect(JSON.stringify(mine[1].before)).toContain("yes");
  });

  it("K1: a question review's event keeps the old questions and every answer it removes, closed ones too", async () => {
    const to = await redirected(() => submitForm(project, checklistId, undefined, form({ label: "Closed run", [`a:${qA}`]: "kept" })));
    const id = to.split("/").pop() as string;
    await saveDraft(project, id, undefined, form({ label: "Closed run", [`a:${qA}`]: "kept", intent: "close" }));
    const prisma = await prismaFor(project);
    const cl = await prisma.checklist.findUniqueOrThrow({ where: { id: checklistId }, include: { source: true } });
    const review = form({
      title: cl.title, sourceId: cl.sourceId, controlTopic: cl.controlTopic,
      "q.0.text": "A, reworded?", "q.1.text": "B?",
    });
    review.append("countryIds", countries[0].id);
    review.append("regulationIds", regulations[0].id);
    const reviewed = await redirected(() => saveReviewedQuestions(project, checklistId, undefined, review));
    expect(reviewed).toBe(`/p/${project}/checklists`);
    const [revised] = outbox(checklistId).filter((r) => r.action === "controls.checklist.questions_revised");
    expect(revised.details).toMatchObject({ version: 2, questions: 2 });
    expect(revised.details.closed_answers_removed).toBeGreaterThanOrEqual(1);
    const removed = (revised.content as { removed_answers: { submission: string; status: string; answer: string }[] }).removed_answers;
    expect(removed).toContainEqual(expect.objectContaining({ submission: id, status: "Closed", answer: "kept" }));
    expect((revised.content as { before: { text: string }[] }).before.map((q) => q.text)).toContain("A?");
    expect((await prisma.checklist.findUniqueOrThrow({ where: { id: checklistId } })).questionsVersion).toBe(2);
  });

  it("a source and an install record their events", async () => {
    await redirected(() => createSource(project, undefined, form({ name: `Ledger source ${randomUUID().slice(0, 6)}` })));
    const slug = `ldg-${randomUUID().slice(0, 6)}`;
    expect((await installHere(project, slug, undefined))?.installed).toBeTruthy();
    const all = outbox().map((r) => r.action);
    expect(all).toContain("controls.source.created");
    const [installed] = outbox().filter((r) => r.action === "control.installed" && r.details.package === slug);
    expect(installed.details).toMatchObject({ package: slug, questions: 2 });
  });

  it("a failure right after an event leaves neither the change nor the event", async () => {
    const before = outbox().length;
    state.failAfter = "controls.submission.created";
    await expect(submitForm(project, checklistId, undefined, form({ label: "Never", [`a:${qA}`]: "x" }))).rejects.toThrow(/right after/);
    expect(outbox().length).toBe(before);
    expect(rows(`SELECT count(*) FROM controls.submission WHERE label = 'Never'`, project)).toEqual(["0"]);
  });

  it("nothing is written while the ledger is off", async () => {
    vi.stubEnv("LEDGER_MODE", "off");
    const before = outbox().length;
    await redirected(() => submitForm(project, checklistId, undefined, form({ label: "Off", [`a:${qA}`]: "x" })));
    expect(outbox().length).toBe(before);
  });
});
