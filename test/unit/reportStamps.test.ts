import { describe, it, expect, vi, afterEach } from "vitest";

// The report route hands the renderer each answer's AI card version, read from
// the answers as the submission's page reads them.
const submission = {
  id: "s1",
  label: "Review",
  status: "Closed",
  version: 1,
  createdAt: new Date(2026, 8, 1),
  closedAt: null,
  checklist: {
    title: "T",
    controlTopic: "Transparency",
    countryIds: [],
    regulationIds: [],
    questions: [
      { id: "q1", order: 1, text: "A?", article: null, category: null },
      { id: "q2", order: 2, text: "B?", article: null, category: null },
    ],
    source: { name: "S" },
  },
  answers: [
    { questionId: "q1", answer: "Yes", score: 4, systemVersionNumber: 2 },
    { questionId: "q2", answer: "No", score: null, systemVersionNumber: null },
  ],
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: vi.fn(async () => ({ submission: { findUnique: vi.fn(async () => submission) } })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the report route", () => {
  it("a closed submission's report shows the wording each answer was given under, a removed question's too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80])));
    vi.stubGlobal("fetch", fetchImpl);
    const original = submission.answers;
    submission.answers = [
      { questionId: "q1", answer: "Yes", score: 4, systemVersionNumber: 2, questionText: "A, as asked?",
        questionArticle: null, questionCategory: null, questionOrder: 1 },
      { questionId: null, answer: "Gone", score: null, systemVersionNumber: null, questionText: "Removed?",
        questionArticle: null, questionCategory: null, questionOrder: 2 },
    ] as unknown as typeof original;
    const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
    await GET(new Request("http://c/x"), { params: Promise.resolve({ project: "p1", id: "s1" }) });
    submission.answers = original;
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.groups[0].entries.map((e: { text: string; answer: string | null }) => [e.text, e.answer])).toEqual([
      ["A, as asked?", "Yes"], ["Removed?", "Gone"], ["B?", null],
    ]);
  });

  it("sends the AI card versions the answers were given under", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80])));
    vi.stubGlobal("fetch", fetchImpl);
    const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
    await GET(new Request("http://c/x"), { params: Promise.resolve({ project: "p1", id: "s1" }) });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.cardVersions).toEqual([2]);
    expect(body.groups[0].entries.map((e: { stamp: string | null }) => e.stamp)).toEqual([
      "answered under v2",
      "AI card version not recorded",
    ]);
  });
});
