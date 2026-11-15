import { describe, it, expect } from "vitest";
import { buildReportPayload, type ReportInput } from "@/lib/report";

// An answer is given under a card version and, once the card was corrected, under one of its
// revisions. The stamp shown beside an answer names the revision as well, so an amendment made
// because of card corrections can tell answers given before the correction from those after it.

const base: ReportInput = {
  label: "FRAIA",
  status: "Closed",
  version: 2,
  createdAt: new Date(2026, 10, 11, 10, 0),
  closedAt: new Date(2026, 10, 12, 9, 0),
  checklistTitle: "FRAIA",
  sourceName: "Fake source",
  controlTopic: "Rights",
  countries: [],
  regulations: [],
  questions: [
    { id: "q1", order: 0, text: "Before the correction?", article: null, category: null },
    { id: "q2", order: 1, text: "After the correction?", article: null, category: null },
  ],
  answersByQ: { q1: "Yes", q2: "Yes" },
  scoresByQ: {},
  versionByQ: { q1: 1, q2: 1 },
};

describe("an answer's stamp names the card revision", () => {
  it("answers given under two revisions of version 1 are told apart", () => {
    const input = { ...base, revisionByQ: { q1: 1, q2: 2 } } as ReportInput;
    const [first, second] = buildReportPayload(input, new Date(2026, 10, 12, 10, 0)).groups[0].entries;
    expect(second.stamp).toMatch(/v1(\.| rev(ision)? )2/);
    expect(first.stamp).not.toBe(second.stamp);
  });
});
