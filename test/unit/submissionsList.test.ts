import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The submissions list counts a submission's coverage over what its page shows: a closed one over the
// questions as it answered them, an answer to a question removed since included.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const closed = {
  id: "s1", label: "Spring run", status: "Closed", version: 1, updatedAt: new Date(2026, 9, 1),
  checklist: { title: "Logging", controlTopic: "Records", source: { id: "src", name: "S" }, questions: [] },
  answers: [{ id: "a1", questionId: null, answer: "Kept", score: 5, systemVersionNumber: null,
              questionText: "Is it logged?", questionArticle: null, questionCategory: null, questionOrder: 1 }],
  _count: { answers: 1 },
};
vi.mock("@/lib/submissions", () => ({ submissionsOfProject: async () => [closed] }));

import SubmissionsPage from "@/app/p/[project]/submissions/page";

describe("the submissions list", () => {
  it("counts a closed submission over the questions it answered", async () => {
    const html = renderToStaticMarkup(await SubmissionsPage({ params: Promise.resolve({ project: P1 }) }));
    expect(html).toContain("1/1 (100%)");
    expect(html).toMatch(/Maturity:\s*(<!-- -->)?\s*<strong>100%<\/strong>/);
    expect(html).toMatch(/class="status status--closed">Final</);
  });
});
