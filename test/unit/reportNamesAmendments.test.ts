import { describe, it, expect, vi, afterEach } from "vitest";

// The PDF of a submission says what its page says about its versions: an amendment names why it was made
// and who asked for it, and a version that was replaced says so (and by which version).
const REASON = "Corrections requested by the provider after the card was revised";
const REQUESTER = "Mijke team";

const h = vi.hoisted(() => ({ sub: null as Record<string, unknown> | null, next: null as Record<string, unknown> | null }));

const base = {
  label: "Fundamental rights review",
  status: "Closed",
  createdAt: new Date(2026, 9, 1),
  closedAt: new Date(2026, 9, 2),
  checklistId: "chk",
  archivedAt: null,
  checklist: { title: "FRAIA", controlTopic: "Rights", countryIds: [], regulationIds: [], questions: [], source: { name: "S" } },
  answers: [],
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: vi.fn(async () => ({
    submission: {
      // The submission asked for by id; the version after it, when asked for by its previous version.
      findUnique: vi.fn(async (q: { where: { id?: string; previousVersionId?: string } }) =>
        q.where.previousVersionId ? h.next : { ...h.sub, nextVersion: h.next }),
      findFirst: vi.fn(async () => h.next),
      findMany: vi.fn(async () => [h.sub, h.next].filter(Boolean)),
    },
    submissionAnswerFile: { findMany: vi.fn(async () => []) },
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The JSON the route sends to the PDF renderer for this submission. */
async function payloadSent(): Promise<string> {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80]), { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);
  const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
  await GET(new Request("http://localhost/report"), {
    params: Promise.resolve({ project: "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b", id: String(h.sub?.id) }),
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  return String((fetchImpl.mock.calls[0][1] as RequestInit).body);
}

describe("the PDF of a submission's versions", () => {
  it("an amendment's PDF names why it was made and who asked for it", async () => {
    h.sub = { ...base, id: "s2", version: 2, previousVersionId: "s1", amendReason: REASON, amendRequestedBy: REQUESTER };
    h.next = null;
    const body = await payloadSent();
    expect(body).toContain(REASON);
    expect(body).toContain(REQUESTER);
  });

  it("a replaced version's PDF says it was replaced", async () => {
    h.sub = { ...base, id: "s1", version: 1, previousVersionId: null, amendReason: null, amendRequestedBy: null };
    h.next = { ...base, id: "s2", version: 2, previousVersionId: "s1", amendReason: REASON, amendRequestedBy: REQUESTER };
    const body = await payloadSent();
    expect(body).toMatch(/replaced|superseded/i);
  });
});
