import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The template editor (checklists/[id]/review) is off unless AISC_ENABLE_TEMPLATE_EDITOR=true.
// The flag hid only the "Edit template" link: the page and its action stayed open to any
// writer who typed the URL or posted the action. Now, with the flag off, the page is not found and the
// action refuses in the shape of any refused write ({ error }), with its own message, before it opens the database or writes to the ledger.

const h = vi.hoisted(() => ({
  checklist: null as unknown,
  access: { ok: true, admin: true } as { ok: boolean; admin?: boolean },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url });
  },
}));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: vi.fn(async () => ({
    checklist: { findUnique: vi.fn(async () => h.checklist) },
    source: { findMany: vi.fn(async () => []) },
    submissionAnswer: { findMany: vi.fn(async () => []) },
  })),
  writableProject: vi.fn(async () => ({
    prisma: { checklist: { findUnique: vi.fn(async () => null) } },
  })),
  callerAccess: vi.fn(async () => h.access),
}));
vi.mock("@/vendor/aisc-ledger/emit", () => ({ emitEvent: vi.fn(), ledgerOn: vi.fn(() => false) }));

import { callerAccess, projectDbFor, writableProject } from "@/lib/projectDb";
import { emitEvent, ledgerOn } from "@/vendor/aisc-ledger/emit";
const READ_ONLY = "You can read this project but not change it.";
import ReviewPage from "@/app/p/[project]/checklists/[id]/review/page";
import { saveReviewedQuestions } from "@/app/p/[project]/checklists/[id]/review/actions";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const params = Promise.resolve({ project: P1, id: "chk" });

beforeEach(() => {
  vi.clearAllMocks();
  h.access = { ok: true, admin: true };
  h.checklist = {
    id: "chk",
    title: "T",
    sourceId: "s",
    controlTopic: "Accuracy",
    description: null,
    sourceUpdatedAt: null,
    countryIds: [],
    regulationIds: [],
    questions: [{ id: "q1", text: "A?", article: null, category: null }],
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the template editor, with AISC_ENABLE_TEMPLATE_EDITOR off", () => {
  for (const value of [undefined, "", "false", "1"]) {
    it(`the review page is not found (flag ${JSON.stringify(value)}), and no database is opened`, async () => {
      vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", value as string);
      await expect(ReviewPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
      expect(projectDbFor).not.toHaveBeenCalled();
    });
  }

  it("the save action refuses with its own message, in the shape of any refused write, before the database and the ledger", async () => {
    vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", "");
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(state).toEqual({ error: "The question editor is turned off on this installation." });
    expect(writableProject).not.toHaveBeenCalled();
    expect(projectDbFor).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(ledgerOn).not.toHaveBeenCalled();
  });
});

describe("the template editor, with AISC_ENABLE_TEMPLATE_EDITOR=true", () => {
  beforeEach(() => {
    vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", "true");
  });

  it("the review page renders the checklist's editor", async () => {
    const page = await ReviewPage({ params });
    expect(page).toBeTruthy();
    expect(projectDbFor).toHaveBeenCalledWith(P1, { write: false });
  });

  it("the review page of a missing checklist is still not found", async () => {
    h.checklist = null;
    await expect(ReviewPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the save action goes on to the project's database, as before", async () => {
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(writableProject).toHaveBeenCalledWith(P1);
    expect(state).toEqual({ error: "Checklist not found." });
  });

  it("the save action still returns a viewer's refusal", async () => {
    vi.mocked(writableProject).mockResolvedValueOnce({ refused: { error: READ_ONLY } });
    expect(await saveReviewedQuestions(P1, "chk", undefined, new FormData())).toEqual({ error: READ_ONLY });
  });
});

// The editor, when it is on, is for administrators only. A project editor could
// reword or remove questions, and a removed question takes its answers with it, closed submissions' too.
describe("the template editor, when on, is for administrators only", () => {
  beforeEach(() => {
    vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", "true");
  });

  it("a project editor who is not an administrator posting the action is refused, before the database", async () => {
    h.access = { ok: true, admin: false };
    const prisma = { checklist: { findUnique: vi.fn(async () => null) } };
    vi.mocked(writableProject).mockResolvedValueOnce({ prisma } as never);
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(state).toEqual({ error: "Only an administrator can edit a checklist's questions." });
    expect(prisma.checklist.findUnique).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("an owner who is not an administrator is refused too", async () => {
    h.access = { ok: true, admin: false };
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(state).toEqual({ error: "Only an administrator can edit a checklist's questions." });
  });

  it("with the platform silent on the second ask, the action refuses (fails closed)", async () => {
    h.access = { ok: false };
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(state).toEqual({ error: "Only an administrator can edit a checklist's questions." });
  });

  it("an administrator's save goes on to the checklist", async () => {
    const state = await saveReviewedQuestions(P1, "chk", undefined, new FormData());
    expect(callerAccess).toHaveBeenCalledWith(P1);
    expect(state).toEqual({ error: "Checklist not found." });
  });

  it("the review page is not found for somebody who is not an administrator", async () => {
    h.access = { ok: true, admin: false };
    await expect(ReviewPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
