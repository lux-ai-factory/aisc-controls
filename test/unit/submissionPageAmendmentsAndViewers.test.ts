import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A submission's page says why an amendment was made and who asked for it (both are required when it is
// made), and shows a person who may only read the project no button that would change it.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const REASON = "Corrections requested by the provider after the card was revised";
const REQUESTER = "Mijke team";

type Row = {
  id: string;
  version: number;
  status: "Draft" | "Closed";
  closedAt: Date | null;
  archivedAt: Date | null;
  previousVersionId: string | null;
  amendReason: string | null;
  amendRequestedBy: string | null;
};

const h = vi.hoisted(() => ({ chain: [] as Row[], sub: null as unknown, mayWrite: true }));

vi.mock("@/lib/projectDb", () => ({
  projectDbFor: async () => ({
    submission: {
      findMany: async () => h.chain,
      findUnique: async () => h.sub,
      findFirst: async () => h.sub,
    },
    submissionAnswerFile: { findMany: async () => [] },
  }),
  callerAccess: async (pid: string) => ({
    ok: true, pid, slug: pid, role: h.mayWrite ? "editor" : "viewer", admin: false, mayWrite: h.mayWrite,
  }),
}));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({
  archiveSubmission: async () => {},
  reopenForAmendment: async () => {},
  restoreSubmission: async () => {},
  discardDraft: async () => {},
  saveDraft: async () => undefined,
}));
vi.mock("@/app/p/[project]/submissions/[id]/DraftEditForm", () => ({
  default: () => "draft-edit-form",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SubmissionDetailPage from "@/app/p/[project]/submissions/[id]/page";

const row = (id: string, version: number, over: Partial<Row> = {}): Row => ({
  id, version, status: "Closed", closedAt: new Date(2026, 9, version), archivedAt: null,
  previousVersionId: null, amendReason: null, amendRequestedBy: null, ...over,
});

function submission(r: Row) {
  return {
    ...r,
    label: "Fundamental rights review",
    checklistId: "chk",
    createdAt: new Date(2026, 9, 1),
    questionsVersion: 1,
    checklist: {
      title: "FRAIA",
      source: { name: "S" },
      questions: [{ id: "q1", text: "Is it logged?", article: null, category: null, order: 1 }],
    },
    answers: [],
  };
}

async function page(id: string, search: { discard?: string } = {}) {
  return renderToStaticMarkup(
    await SubmissionDetailPage({ params: Promise.resolve({ project: P1, id }), searchParams: Promise.resolve(search) }),
  );
}

beforeEach(() => {
  h.mayWrite = true;
  h.chain = [
    row("s1", 1),
    row("s2", 2, { previousVersionId: "s1", amendReason: REASON, amendRequestedBy: REQUESTER }),
  ];
});

describe("an amendment", () => {
  it("says why it was made and who asked for it", async () => {
    h.sub = submission(h.chain[1]);
    const html = await page("s2");
    expect(html).toContain(REASON);
    expect(html).toContain(REQUESTER);
  });

  it("the version it replaced says why it was replaced, in the version history", async () => {
    h.sub = submission(h.chain[0]);
    const history = (await page("s1")).match(/<section class="version-chain"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(history).toContain(REASON);
  });
});

describe("a person who may only read the project", () => {
  beforeEach(() => {
    h.mayWrite = false;
  });

  it("is offered no amend and no archive on a final submission", async () => {
    h.sub = submission(h.chain[1]);
    const html = await page("s2");
    expect(html).not.toContain("Amend (makes version");
    expect(html).not.toMatch(/>Archive</);
  });

  it("is offered no restore on an archived one", async () => {
    h.chain = [row("s1", 1, { archivedAt: new Date(2026, 9, 5) })];
    h.sub = submission(h.chain[0]);
    expect(await page("s1")).not.toContain("Restore from archive");
  });

  it("is offered no discard and no edit form on a draft", async () => {
    h.chain = [row("d1", 1, { status: "Draft", closedAt: null })];
    h.sub = submission(h.chain[0]);
    const html = await page("d1");
    expect(html).not.toContain("Discard draft");
    expect(html).not.toContain("draft-edit-form");
  });

  it("is told that they can read the project but not change it", async () => {
    h.sub = submission(h.chain[1]);
    expect(await page("s2")).toMatch(/can read this project but not change it/i);
  });

  it("still gets the report download", async () => {
    h.sub = submission(h.chain[1]);
    expect(await page("s2")).toContain("Download report (PDF)");
  });
});
