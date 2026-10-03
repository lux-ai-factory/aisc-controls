import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// The ledger, against a project database made the platform's way (its template has
// ledger.emit): every controls write records its event in the change's own transaction, a
// failure after the event leaves neither, and a question review's event keeps what the review deletes
// (the old questions, and every answer removed, closed submissions' too). Throwaway Postgres only.

const state = vi.hoisted(() => ({ request: "", failAfter: "", onLatest: null as null | (() => void), sourceName: "" }));
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
vi.mock("@/lib/systemVersion", () => ({
  // a test can act between a save's reads and its transaction (the platform is asked in between)
  latestVersion: async () => {
    state.onLatest?.();
    state.onLatest = null;
    return null;
  },
}));
vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async (slug: string) => ({
    ok: true,
    pkg: { meta: { catalogueId: slug, title: `Control ${slug}`, sourceName: state.sourceName || `Src ${slug}`, controlTopic: "T" },
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
import { installFromCatalogue } from "@/app/p/[project]/install/actions";
import { POST as installApi } from "@/app/api/install/route";
import { hasThrowawayDb, makeProject, dropProject, rows, su } from "./throwawayDb";
import { projectDatabaseName } from "@/lib/projectDb";
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
  content: Record<string, unknown> | null; before: Record<string, unknown> | null;
  after: Record<string, unknown> | null; item_version: string | null };

describe.skipIf(!hasThrowawayDb)("ledger phase 7: every controls write records its event", () => {
  let project: string;
  let checklistId: string;
  let qA: string;

  function outbox(item?: string): Row[] {
    return rows(
      `SELECT json_build_object('action', action, 'item_id', item_id, 'db_role', db_role, 'request_id', request_id,
              'details', details, 'content', content, 'before', before, 'after', after, 'item_version', item_version)
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
    state.onLatest = null;
    state.sourceName = "";
  });

  /** A fresh checklist of two questions, so a test's review touches no other test's submissions. */
  async function freshChecklist(): Promise<{ id: string; q: string[] }> {
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const made = await prisma.checklist.create({
      data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "Testing",
              questions: { create: [{ order: 1, text: "A?" }, { order: 2, text: "B?" }] } },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    return { id: made.id, q: made.questions.map((x) => x.id) };
  }

  /** The review form of a checklist as it stands, with the given question texts. */
  async function reviewForm(id: string, texts: string[], title?: string): Promise<FormData> {
    const prisma = await prismaFor(project);
    const cl = await prisma.checklist.findUniqueOrThrow({ where: { id } });
    const fd = form({ title: title ?? cl.title, sourceId: cl.sourceId, controlTopic: cl.controlTopic });
    texts.forEach((t, i) => fd.set(`q.${i}.text`, t));
    fd.append("countryIds", countries[0].id);
    fd.append("regulationIds", regulations[0].id);
    return fd;
  }

  async function closedSubmission(checklist: string, q: string, answer: string): Promise<string> {
    const id = (await redirected(() => submitForm(project, checklist, undefined, form({ label: "Run", [`a:${q}`]: answer }))))
      .split("/").pop() as string;
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${q}`]: answer, intent: "close" }));
    return id;
  }

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

  it("review M1 (guard 1): a review that keeps the questions as they are touches no question, and no answer", async () => {
    const { id, q } = await freshChecklist();
    const sub = await closedSubmission(id, q[0], "kept");
    await redirected(async () => saveReviewedQuestions(project, id, undefined, await reviewForm(id, ["A?", "B?"], "Retitled")));
    const prisma = await prismaFor(project);
    const now = await prisma.checklist.findUniqueOrThrow({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
    expect(now.title).toBe("Retitled");
    expect(now.questions.map((x) => x.id)).toEqual(q);
    expect(now.questionsVersion).toBe(1);
    expect(await prisma.submissionAnswer.count({ where: { submissionId: sub } })).toBe(1);
    const events = outbox(id);
    expect(events.map((r) => r.action)).toEqual(["controls.checklist.edited"]);
    expect(events[0].before).toMatchObject({ title: expect.stringMatching(/^C /) });
    expect(events[0].after).toMatchObject({ title: "Retitled" });
  });

  it("review m1: a draft closed while its save is under way is not rewritten, and no save is recorded", async () => {
    const { id, q } = await freshChecklist();
    const sub = (await redirected(() => submitForm(project, id, undefined, form({ label: "Two tabs", [`a:${q[0]}`]: "first" }))))
      .split("/").pop() as string;
    // the other tab closes it after this save has read the draft, before its transaction
    state.onLatest = () => su(`UPDATE controls.submission SET status = 'Closed', closed_at = now() WHERE id = '${sub}'`,
                              projectDatabaseName(project));
    const answer = await saveDraft(project, sub, undefined, form({ label: "Two tabs", [`a:${q[0]}`]: "changed" }));
    expect(answer).toEqual({ error: expect.stringMatching(/Only draft submissions/) });
    expect(rows(`SELECT answer FROM controls.submission_answer WHERE "submissionId" = '${sub}'`, project)).toEqual(["first"]);
    expect(outbox(sub).map((r) => r.action)).toEqual(["controls.submission.created"]);
  });

  it("review m3: a submission's first save continues the state its creation recorded, whatever the answers' order", async () => {
    const { id, q } = await freshChecklist();
    const [low, high] = [...q].sort((x, y) => x.localeCompare(y));
    const fd = form({ label: "Order" });
    fd.set(`a:${high}`, "h");
    fd.set(`a:${low}`, "l");
    const sub = (await redirected(() => submitForm(project, id, undefined, fd))).split("/").pop() as string;
    await saveDraft(project, sub, undefined, form({ label: "Order", [`a:${low}`]: "l", [`a:${high}`]: "h" }));
    const [created, saved] = outbox(sub);
    expect(saved.before).toEqual(created.after);
  });

  it("review m4: two reviews at once give two versions, each recorded once", async () => {
    const { id } = await freshChecklist();
    await Promise.all([
      redirected(async () => saveReviewedQuestions(project, id, undefined, await reviewForm(id, ["One?"]))),
      redirected(async () => saveReviewedQuestions(project, id, undefined, await reviewForm(id, ["Two?"]))),
    ]);
    const versions = outbox(id).filter((r) => r.action === "controls.checklist.questions_revised").map((r) => r.item_version);
    expect(versions.sort()).toEqual(["2", "3"]);
  });

  it("review m5: an install records what was installed, and a review's after names its new questions", async () => {
    const slug = `ldg-${randomUUID().slice(0, 6)}`;
    await installHere(project, slug, undefined);
    const [installed] = outbox().filter((r) => r.action === "control.installed" && r.details.package === slug);
    const prisma = await prismaFor(project);
    const cl = await prisma.checklist.findUniqueOrThrow({ where: { id: installed.item_id }, include: { questions: { orderBy: { order: "asc" } }, source: true } });
    expect(installed.content).toMatchObject({
      package_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      source: { name: cl.source.name },
      questions: cl.questions.map((x) => ({ id: x.id, order: x.order, text: x.text })),
    });
    await redirected(async () => saveReviewedQuestions(project, cl.id, undefined, await reviewForm(cl.id, ["New?"])));
    const [revised] = outbox(cl.id).filter((r) => r.action === "controls.checklist.questions_revised");
    const now = await prisma.question.findMany({ where: { checklistId: cl.id } });
    expect((revised.content as { after: { id: string }[] }).after.map((x) => x.id)).toEqual(now.map((x) => x.id));
  });

  it("review m6: a reopening records the amendment's first state, which its first save continues", async () => {
    const { id, q } = await freshChecklist();
    const sub = await closedSubmission(id, q[0], "v1");
    const next = (await redirected(() => reopenForAmendment(project, sub))).split("/").pop() as string;
    const [reopened] = outbox(sub).filter((r) => r.action === "controls.submission.reopened");
    await saveDraft(project, next, undefined, form({ label: "Run", [`a:${q[0]}`]: "v2" }));
    const [saved] = outbox(next);
    expect(reopened.content).toEqual({ next: saved.before });
  });

  it("review m9: a failure right after a save's, an archive's or an install's event leaves neither", async () => {
    const { id, q } = await freshChecklist();
    const sub = (await redirected(() => submitForm(project, id, undefined, form({ label: "F", [`a:${q[0]}`]: "x" }))))
      .split("/").pop() as string;
    state.failAfter = "controls.submission.draft_saved";
    await expect(saveDraft(project, sub, undefined, form({ label: "F", [`a:${q[0]}`]: "y" }))).rejects.toThrow(/right after/);
    expect(rows(`SELECT answer FROM controls.submission_answer WHERE "submissionId" = '${sub}'`, project)).toEqual(["x"]);
    const closed = await closedSubmission(id, q[0], "c");
    state.failAfter = "controls.submission.archived";
    await expect(archiveSubmission(project, closed)).rejects.toThrow(/right after/);
    expect(rows(`SELECT archived_at IS NULL FROM controls.submission WHERE id = '${closed}'`, project)).toEqual(["t"]);
    expect(outbox(closed).map((r) => r.action)).not.toContain("controls.submission.archived");
    for (const install of [
      (slug: string) => redirected(() => installFromCatalogue(project, slug, undefined)),
      async (slug: string) => {
        vi.stubEnv("CATALOGUE_ORIGIN", "https://catalogue.test");
        const body = new FormData();
        body.set("project", project);
        body.set("slug", slug);
        return installApi(new Request("https://controls.test/api/install", { method: "POST", body, headers: { origin: "https://catalogue.test" } }));
      },
    ]) {
      const slug = `ldg-${randomUUID().slice(0, 6)}`;
      state.failAfter = "control.installed";
      await install(slug).catch(() => undefined);
      expect(rows(`SELECT count(*) FROM controls.checklist WHERE "catalogueId" = '${slug}'`, project)).toEqual(["0"]);
      // and without the failure, each path records its install
      const other = `ldg-${randomUUID().slice(0, 6)}`;
      await install(other);
      expect(outbox().filter((r) => r.action === "control.installed" && r.details.package === other)).toHaveLength(1);
    }
  });

  it("review m9: two installs that make one new source at once each record their install", async () => {
    for (let round = 0; round < 5; round++) {
      state.sourceName = `Shared ${randomUUID().slice(0, 6)}`;
      const slugs = [`ldg-${randomUUID().slice(0, 6)}`, `ldg-${randomUUID().slice(0, 6)}`];
      await Promise.all(slugs.map((slug) => installHere(project, slug, undefined)));
      for (const slug of slugs) {
        expect(outbox().filter((r) => r.action === "control.installed" && r.details.package === slug)).toHaveLength(1);
      }
    }
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
