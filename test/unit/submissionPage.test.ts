import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// What a submission's page shows: its version history, the actions a version
// may take, and its answers.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

type Row = {
  id: string;
  version: number;
  status: "Draft" | "Closed";
  closedAt: Date | null;
  archivedAt: Date | null;
  previousVersionId: string | null;
};

const h = vi.hoisted(() => ({ chain: [] as Row[], sub: null as unknown }));

vi.mock("@/lib/projectDb", () => ({
  projectDbFor: async () => ({ submission: { findMany: async () => h.chain } }),
}));
vi.mock("@/lib/submissions", () => ({ submissionOfProject: async () => h.sub }));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({
  archiveSubmission: async () => {},
  reopenForAmendment: async () => {},
  restoreSubmission: async () => {},
  discardDraft: async () => {},
  saveDraft: async () => undefined,
}));
vi.mock("@/app/p/[project]/submissions/[id]/DraftEditForm", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SubmissionDetailPage from "@/app/p/[project]/submissions/[id]/page";

const closed = (id: string, version: number, previousVersionId: string | null): Row => ({
  id, version, status: "Closed", closedAt: new Date(2026, 9, version), archivedAt: null, previousVersionId,
});

function submission(row: Row, questions = [{ id: "q1", text: "Is it logged?", article: null, category: null, order: 1 }]) {
  return {
    ...row,
    label: "Acme",
    checklistId: "chk",
    createdAt: new Date(2026, 9, 1),
    checklist: { title: "Record keeping", source: { name: "S" }, questions },
    answers: [],
  };
}

async function page(id: string, search: { discard?: string } = {}) {
  return renderToStaticMarkup(
    await SubmissionDetailPage({ params: Promise.resolve({ project: P1, id }), searchParams: Promise.resolve(search) }),
  );
}

const draft = (id: string): Row => ({ id, version: 1, status: "Draft", closedAt: null, archivedAt: null, previousVersionId: null });

/** The version history's own markup. */
const history = (html: string) => html.match(/<section class="version-chain"[\s\S]*?<\/section>/)?.[0] ?? "";

beforeEach(() => {
  h.chain = [closed("s1", 1, null), closed("s2", 2, "s1"), closed("s3", 3, "s2")];
});

describe("the version history", () => {
  it("links to the other versions, and shows the one you are on as plain text marked current", async () => {
    h.sub = submission(h.chain[1]);
    const html = history(await page("s2"));
    expect(html).toContain(`href="/p/${P1}/submissions/s1"`);
    expect(html).toContain(`href="/p/${P1}/submissions/s3"`);
    expect(html).not.toContain(`href="/p/${P1}/submissions/s2"`);
    expect(html).toMatch(/v2[\s\S]*current/);
  });
});

describe("a closed version that has a next version", () => {
  it("offers no amend or archive, and says which version replaced it, with a link to it", async () => {
    h.sub = submission(h.chain[0]);
    const html = await page("s1");
    expect(html).not.toContain("Amend");
    expect(html).not.toContain(">Archive<");
    expect(html).toMatch(new RegExp(`<a href="/p/${P1}/submissions/s2"[^>]*>Replaced by v2</a>|Replaced by <a href="/p/${P1}/submissions/s2"[^>]*>v2</a>`));
  });

  it("the latest closed version still offers both", async () => {
    h.sub = submission(h.chain[2]);
    const html = await page("s3");
    expect(html).toContain("Amend (makes version 4)");
    expect(html).toContain(">Archive<");
    expect(html).not.toContain("Replaced");
    expect(html).not.toContain("Reopen");
  });
});

describe("a closed submission's answers", () => {
  it("are grouped by category, each category printed once as a heading", async () => {
    const q = (id: string, category: string, order: number) => ({ id, text: `${id}?`, article: null, category, order });
    h.sub = submission(h.chain[2], [q("q1", "Logging", 1), q("q2", "Logging", 2), q("q3", "Oversight", 3)]);
    const html = await page("s3");
    expect(html.match(/Logging/g)).toHaveLength(1);
    expect(html.match(/Oversight/g)).toHaveLength(1);
    expect(html).toContain("<h2>Logging</h2>");
    expect(html.indexOf("q2?")).toBeLessThan(html.indexOf("<h2>Oversight</h2>"));
  });
});

describe("discarding a draft", () => {
  it("a draft offers it, as a link to a confirmation", async () => {
    h.chain = [draft("d1")];
    h.sub = submission(h.chain[0]);
    const html = await page("d1");
    expect(html).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/submissions/d1\\?discard=1"[^>]*>Discard draft</a>`));
    expect(html).not.toContain("Yes, discard it");
  });

  it("the confirmation says what goes, and asks again with a button, or keeps it", async () => {
    h.chain = [draft("d1")];
    h.sub = submission(h.chain[0]);
    const html = await page("d1", { discard: "1" });
    expect(html).toContain("Discard this draft and its answers? This cannot be undone.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Yes, discard it<\/button>/);
    expect(html).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/submissions/d1"[^>]*>Keep it</a>`));
  });

  it("a closed submission offers no discard, even when asked in the address", async () => {
    h.sub = submission(h.chain[2]);
    const html = await page("s3", { discard: "1" });
    expect(html).not.toMatch(/Discard|Yes, discard it/);
  });
});

describe("a closed submission answered under an older template", () => {
  const asked = { questionText: "Is it logged?", questionArticle: "Art. 12", questionCategory: "Logging", questionOrder: 1 };
  const reworded = [{ id: "q1", text: "Is every event logged?", article: "Art. 12(1)", category: "Records", order: 1 }];

  it("shows the wording it was answered under, never today's", async () => {
    h.sub = { ...submission(h.chain[2], reworded), questionsVersion: 3,
              answers: [{ id: "a1", questionId: "q1", answer: "Yes", score: 4, systemVersionNumber: null, ...asked }] };
    const html = await page("s3");
    expect(html).toContain("Is it logged?");
    expect(html).toContain("Art. 12<");
    expect(html).toContain("<h2>Logging</h2>");
    expect(html).not.toMatch(/Is every event logged\?|Art\. 12\(1\)|Records/);
  });

  it("keeps an answer to a question removed since", async () => {
    h.sub = { ...submission(h.chain[2], []), questionsVersion: 3,
              answers: [{ id: "a1", questionId: null, answer: "Kept", score: null, systemVersionNumber: null, ...asked }] };
    const html = await page("s3");
    expect(html).toContain("Is it logged?");
    expect(html).toContain("Kept");
    expect(html).toContain("1 of 1 questions answered");
  });

  it("says which checklist revision it answered", async () => {
    h.sub = { ...submission(h.chain[2]), questionsVersion: 3 };
    expect(await page("s3")).toContain("Answered under checklist revision 3");
  });

  it("a draft names no revision: it follows the checklist", async () => {
    h.chain = [draft("d1")];
    h.sub = { ...submission(h.chain[0]), questionsVersion: null };
    expect(await page("d1")).not.toContain("checklist revision");
  });
});

// The words a final submission is shown in: its status "Final" (stored as Closed), each question's
// maturity with the level's name, and plain words where an answer or a version is missing.
describe("a final submission's wording", () => {
  const scored = (score: number | null, answer: string | null, systemVersionNumber: number | null) => ({
    ...submission(h.chain[2]),
    answers: [{ id: "a1", questionId: "q1", answer, score, systemVersionNumber,
                questionText: "Is it logged?", questionArticle: null, questionCategory: null, questionOrder: 1 }],
  });

  it("calls the status Final, never Closed", async () => {
    h.sub = submission(h.chain[2]);
    const html = await page("s3");
    expect(html).toMatch(/class="status status--closed">Final</);
    expect(html).not.toMatch(/>Closed<|closed \d/);
    expect(html).toContain("finalised");
  });

  it("shows a question's score as its maturity, with the level's name", async () => {
    h.sub = scored(4, "Yes", 2);
    const html = await page("s3");
    expect(html).toContain("Maturity 4/5 (Established)");
    expect(html).toContain(">Maturity<");
    expect(html).not.toMatch(/Readiness|readiness =/);
  });

  it("says an unanswered question is not answered, without dashes", async () => {
    h.sub = submission(h.chain[2]);
    const html = await page("s3");
    expect(html).toContain(">Not answered<");
    expect(html).not.toContain("\u2014");
  });

  it("says when an answer's AI card version was not recorded", async () => {
    h.sub = scored(null, "Yes", null);
    const html = await page("s3");
    expect(html).toContain("AI card version not recorded");
    expect(html).not.toContain("not stamped");
  });
});
