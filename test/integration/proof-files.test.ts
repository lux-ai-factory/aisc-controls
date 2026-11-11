import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Proof files on a project database made the platform's way: a file attached to a draft's question is
// linked to its answer (made if the question had none) with its ledger event in the same transaction;
// only a draft takes or loses files, at most 10 per question; anybody in the project downloads them; a
// new version starts with the previous one's files linked. The platform, which stores the files, is
// replaced at its boundary (src/lib/proofStore.ts) by an in-memory one. Throwaway Postgres only.

const state = vi.hoisted(() => ({
  request: "",
  role: "editor",
  stored: new Map<string, { bytes: Uint8Array; mime: string; name: string; sha256: string }>(),
  refuse: null as null | { status: number; error: string },
  platformCalls: 0,
  afterStore: null as null | (() => void),
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
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-aisc-request-id": state.request }) }));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: async (pid: string, method: string) => {
    const write = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    if (write && state.role === "viewer") return { ok: false, status: 403, message: "Viewers cannot change this project." };
    return { ok: true, pid, slug: pid, role: state.role, admin: false, mayWrite: state.role !== "viewer" };
  },
}));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "caller-token" }));
vi.mock("@/lib/access/callerName", () => ({ callerName: async () => "alice@example.org" }));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => null }));
vi.mock("@/lib/proofStore", async (importOriginal) => {
  const { createHash, randomUUID } = await import("node:crypto");
  return {
    ...(await importOriginal<typeof import("@/lib/proofStore")>()),
    storeProofFile: async (_pid: string, name: string, bytes: Uint8Array) => {
      state.platformCalls += 1;
      if (state.refuse) return { ok: false, ...state.refuse };
      const id = randomUUID();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      state.stored.set(id, { bytes, mime: "application/pdf", name, sha256 });
      state.afterStore?.();
      return { ok: true, file: { id, name, mime: "application/pdf", size: bytes.length, sha256 } };
    },
    readProofFile: async (_pid: string, id: string) => {
      state.platformCalls += 1;
      const found = state.stored.get(id);
      return found ? new Response(found.bytes, { headers: { "content-type": found.mime } }) : null;
    },
  };
});

import { createHash, randomUUID } from "node:crypto";

import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { saveDraft, reopenForAmendment } from "@/app/p/[project]/submissions/[id]/actions";

const AMEND = { reason: "Corrected a date", requestedBy: "Test auditor" };
import { POST as attach } from "@/app/p/[project]/submissions/[id]/questions/[question]/files/route";
import { GET as download, DELETE as remove } from "@/app/p/[project]/submissions/[id]/questions/[question]/files/[file]/route";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";

const REQUEST = "b8b8b8b8-0000-4000-8000-000000000001";
const PDF = new TextEncoder().encode("%PDF-1.7 a proof\n%%EOF\n");

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

/** A browser's attach: a same-origin fetch of a multipart form with the file. */
function attachRequest(name = "policy.pdf", bytes: Uint8Array = PDF, headers: Record<string, string> = {}): Request {
  const body = new FormData();
  body.set("file", new File([bytes], name, { type: "application/pdf" }));
  return new Request("https://controls.test/p/x/files", {
    method: "POST", body,
    headers: { "x-requested-with": "aisc-controls", "sec-fetch-site": "same-origin", ...headers },
  });
}

const sameOrigin = (method: string) =>
  new Request("https://controls.test/p/x/files/f", {
    method, headers: { "x-requested-with": "aisc-controls", "sec-fetch-site": "same-origin" },
  });

describe.skipIf(!hasThrowawayDb)("proof files of an answer", () => {
  let project: string;
  let checklistId: string;
  let qA: string;
  let qB: string;

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
    [qA, qB] = checklist.questions.map((q) => q.id);
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  beforeEach(() => {
    vi.stubEnv("LEDGER_MODE", "record");
    vi.stubEnv("AUTH_ENABLED", "false");
    state.request = REQUEST;
    state.role = "editor";
    state.refuse = null;
    state.platformCalls = 0;
    state.afterStore = null;
  });

  async function draft(answers: Record<string, string> = { [`a:${qA}`]: "yes" }): Promise<string> {
    const to = await redirected(() => submitForm(project, checklistId, undefined, form({ label: "Run", ...answers })));
    return to.split("/").pop() as string;
  }

  const at = (submission: string, question: string) =>
    ({ params: Promise.resolve({ project, id: submission, question }) });
  const atFile = (submission: string, question: string, file: string) =>
    ({ params: Promise.resolve({ project, id: submission, question, file }) });

  function links(submission: string): { question: string; file: string; name: string; by: string }[] {
    return rows(
      `SELECT json_build_object('question', a."questionId", 'file', f.file_id, 'name', f.name, 'by', f.uploaded_by)
         FROM controls.submission_answer_file f JOIN controls.submission_answer a ON a.id = f.answer_id
        WHERE a."submissionId" = '${submission}' ORDER BY f.uploaded_at, f.id`, project,
    ).map((line) => JSON.parse(line));
  }

  function events(action: string): { item_type: string; item_id: string; details: Record<string, unknown>;
      content: unknown; request_id: string }[] {
    return rows(
      `SELECT json_build_object('item_type', item_type, 'item_id', item_id, 'details', details, 'content', content,
              'request_id', request_id) FROM ledger.outbox WHERE action = '${action}' ORDER BY occurred_at`, project,
    ).map((line) => JSON.parse(line));
  }

  it("a file attached to an answered question is linked to its answer, with its event", async () => {
    const sub = await draft();
    const res = await attach(attachRequest(), at(sub, qA));
    expect(res.status).toBe(201);
    const { file } = await res.json();
    expect(file).toMatchObject({ name: "policy.pdf", mime: "application/pdf", size: PDF.length,
      sha256: createHash("sha256").update(PDF).digest("hex"), uploadedBy: "alice@example.org" });
    expect(links(sub)).toEqual([{ question: qA, file: file.id, name: "policy.pdf", by: "alice@example.org" }]);
    const [answer] = rows(`SELECT id FROM controls.submission_answer WHERE "submissionId" = '${sub}' AND "questionId" = '${qA}'`, project);
    const [event] = events("control.proof.attached").filter((e) => e.details.file === file.id);
    expect(event).toMatchObject({ item_type: "answer", item_id: answer, request_id: REQUEST, content: null });
    expect(event.details).toEqual({ submission: sub, question: qA, file: file.id, name: "policy.pdf",
      mime: "application/pdf", size: PDF.length, sha256: file.sha256 });
  });

  it("a file attached to an unanswered question makes its answer, which a save keeps", async () => {
    const sub = await draft();
    expect((await attach(attachRequest("b.pdf"), at(sub, qB))).status).toBe(201);
    expect(links(sub).map((l) => l.question)).toEqual([qB]);
    // the answer row holds no answer: the question still counts as unanswered
    expect(rows(`SELECT coalesce(answer, 'NULL') || '/' || coalesce(score::text, 'NULL') FROM controls.submission_answer
                  WHERE "submissionId" = '${sub}' AND "questionId" = '${qB}'`, project)).toEqual(["NULL/NULL"]);
    // a save that leaves B unanswered keeps its files; one that answers it keeps them too
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "still yes" }));
    expect(links(sub).map((l) => l.question)).toEqual([qB]);
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "still yes", [`a:${qB}`]: "now" }));
    expect(links(sub).map((l) => l.question)).toEqual([qB]);
  });

  it("a save keeps the answer each file is linked to", async () => {
    const sub = await draft();
    await attach(attachRequest(), at(sub, qA));
    const before = rows(`SELECT answer_id FROM controls.submission_answer_file f JOIN controls.submission_answer a
                           ON a.id = f.answer_id WHERE a."submissionId" = '${sub}'`, project);
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "changed" }));
    await saveDraft(project, sub, undefined, form({ label: "Run" }));          // the answer cleared, the file kept
    const after = rows(`SELECT answer_id FROM controls.submission_answer_file f JOIN controls.submission_answer a
                          ON a.id = f.answer_id WHERE a."submissionId" = '${sub}'`, project);
    expect(after).toEqual(before);
  });

  it("only a draft takes a file, and the platform is not asked for a closed one", async () => {
    const sub = await draft();
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "yes", intent: "close" }));
    const res = await attach(attachRequest(), at(sub, qA));
    expect(res.status).toBe(409);
    expect(state.platformCalls).toBe(0);
    expect(links(sub)).toEqual([]);
  });

  it("a question takes at most 10 files", async () => {
    const sub = await draft();
    for (let i = 0; i < 10; i++) expect((await attach(attachRequest(`f${i}.pdf`), at(sub, qA))).status).toBe(201);
    state.platformCalls = 0;
    const res = await attach(attachRequest("eleventh.pdf"), at(sub, qA));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/10 files/);
    expect(state.platformCalls).toBe(0);
    expect(links(sub)).toHaveLength(10);
    expect((await attach(attachRequest("other.pdf"), at(sub, qB))).status).toBe(201);   // per question
  });

  it("a file stored but then refused under the draft's lock is logged by its id, so the orphan can be found", async () => {
    const sub = await draft();
    state.afterStore = () => rows(`UPDATE controls.submission SET status = 'Closed' WHERE id = '${sub}'`, project);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await attach(attachRequest("late.pdf"), at(sub, qA));
    const logged = warn.mock.calls.map((c) => c.join(" "));
    warn.mockRestore();
    expect(res.status).toBe(409);
    expect(links(sub)).toEqual([]);
    const [orphan] = [...state.stored.entries()].filter(([, f]) => f.name === "late.pdf").map(([id]) => id);
    expect(logged.some((line) => line.includes(orphan) && line.includes(project.toLowerCase()))).toBe(true);
  });

  it("a file the platform refuses is not linked, and its reason is passed on", async () => {
    const sub = await draft();
    state.refuse = { status: 415, error: "the file's contents do not match its .pdf extension" };
    const res = await attach(attachRequest("fake.pdf"), at(sub, qA));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("the file's contents do not match its .pdf extension");
    expect(links(sub)).toEqual([]);
  });

  it("a viewer can neither attach nor remove, but downloads", async () => {
    const sub = await draft();
    const { file } = await (await attach(attachRequest(), at(sub, qA))).json();
    state.role = "viewer";
    state.platformCalls = 0;
    expect((await attach(attachRequest(), at(sub, qA))).status).toBe(403);
    expect((await remove(sameOrigin("DELETE"), atFile(sub, qA, file.id))).status).toBe(403);
    expect(state.platformCalls).toBe(0);
    const res = await download(new Request("https://controls.test/x"), atFile(sub, qA, file.id));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="policy.pdf"; filename*=UTF-8''policy.pdf`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("a file not linked to that question is not served, and the platform is not asked", async () => {
    const sub = await draft();
    const { file } = await (await attach(attachRequest(), at(sub, qA))).json();
    state.platformCalls = 0;
    expect((await download(new Request("https://controls.test/x"), atFile(sub, qB, file.id))).status).toBe(404);
    expect((await download(new Request("https://controls.test/x"), atFile(sub, qA, randomUUID()))).status).toBe(404);
    expect(state.platformCalls).toBe(0);
  });

  it("removing unlinks the file with its event; the stored file is kept", async () => {
    const sub = await draft({});
    const { file } = await (await attach(attachRequest(), at(sub, qB))).json();
    const [answer] = rows(`SELECT id FROM controls.submission_answer WHERE "submissionId" = '${sub}' AND "questionId" = '${qB}'`, project);
    const res = await remove(sameOrigin("DELETE"), atFile(sub, qB, file.id));
    expect(res.status).toBe(200);
    expect(links(sub)).toEqual([]);
    expect(state.stored.has(file.id)).toBe(true);
    const [event] = events("control.proof.removed").filter((e) => e.details.file === file.id);
    expect(event).toMatchObject({ item_type: "answer", item_id: answer, request_id: REQUEST });
    expect(event.details).toMatchObject({ submission: sub, question: qB, name: "policy.pdf", sha256: file.sha256 });
    // the answer that only held the file goes with it
    expect(rows(`SELECT count(*) FROM controls.submission_answer WHERE "submissionId" = '${sub}'`, project)).toEqual(["0"]);
    expect((await remove(sameOrigin("DELETE"), atFile(sub, qB, file.id))).status).toBe(404);
  });

  it("a closed submission's files are frozen", async () => {
    const sub = await draft();
    const { file } = await (await attach(attachRequest(), at(sub, qA))).json();
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "yes", intent: "close" }));
    expect((await remove(sameOrigin("DELETE"), atFile(sub, qA, file.id))).status).toBe(409);
    expect(links(sub)).toHaveLength(1);
  });

  it("a new version starts with the previous version's files linked, and changes only its own", async () => {
    const sub = await draft({});
    const a = (await (await attach(attachRequest("a.pdf"), at(sub, qA))).json()).file;
    const b = (await (await attach(attachRequest("b.pdf"), at(sub, qB))).json()).file;
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${qA}`]: "yes", intent: "close" }));
    const next = (await redirected(() => reopenForAmendment(project, sub, AMEND))).split("/").pop() as string;
    expect(links(next).map((l) => [l.question, l.file, l.by]).sort())
      .toEqual([[qA, a.id, "alice@example.org"], [qB, b.id, "alice@example.org"]].sort());
    expect((await remove(sameOrigin("DELETE"), atFile(next, qA, a.id))).status).toBe(200);
    expect(links(next).map((l) => l.file)).toEqual([b.id]);
    expect(links(sub).map((l) => l.file).sort()).toEqual([a.id, b.id].sort());
    // the old version still serves it
    expect((await download(new Request("https://controls.test/x"), atFile(sub, qA, a.id))).status).toBe(200);
  });

  it("a closed submission's file on a question removed since downloads under the key the page lists it by", async () => {
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const own = await prisma.checklist.create({
      data: { title: `C ${tag}`, sourceId: source.id, controlTopic: "Testing", questions: { create: [{ order: 1, text: "Gone?" }] } },
      include: { questions: true },
    });
    const gone = own.questions[0].id;
    const to = await redirected(() => submitForm(project, own.id, undefined, form({ label: "Run", [`a:${gone}`]: "yes" })));
    const sub = to.split("/").pop() as string;
    const { file } = await (await attach(attachRequest(), at(sub, gone))).json();
    await saveDraft(project, sub, undefined, form({ label: "Run", [`a:${gone}`]: "yes", intent: "close" }));
    const [answer] = rows(`SELECT id FROM controls.submission_answer WHERE "submissionId" = '${sub}' AND "questionId" = '${gone}'`, project);
    await prisma.question.delete({ where: { id: gone } });                      // a review removed it; the answer stays
    const res = await download(new Request("https://controls.test/x"), atFile(sub, `removed-${answer}`, file.id));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    // the key names that answer only
    expect((await download(new Request("https://controls.test/x"), atFile(sub, `removed-${randomUUID()}`, file.id))).status)
      .toBe(404);
  });

  it("a request from another site is refused", async () => {
    const sub = await draft();
    state.platformCalls = 0;
    expect((await attach(attachRequest("x.pdf", PDF, { "sec-fetch-site": "cross-site" }), at(sub, qA))).status).toBe(403);
    const plain = new FormData();
    plain.set("file", new File([PDF], "x.pdf"));
    const noHeader = new Request("https://controls.test/x", { method: "POST", body: plain });
    expect((await attach(noHeader, at(sub, qA))).status).toBe(403);
    expect(state.platformCalls).toBe(0);
  });

  it("a question of another checklist or a submission that is not there is 404", async () => {
    const sub = await draft();
    expect((await attach(attachRequest(), at(sub, "not-a-question"))).status).toBe(404);
    expect((await attach(attachRequest(), at("not-a-submission", qA))).status).toBe(404);
  });
});
