import { describe, it, expect } from "vitest";
import { buildReportPayload, type ReportInput } from "@/lib/report";

const base: ReportInput = {
  label: "Acme model — Q1 review",
  status: "Closed",
  version: 2,
  createdAt: new Date(2026, 5, 1, 14, 30), // 01/06/2026 14:30 local
  closedAt: new Date(2026, 5, 2, 9, 5),
  checklistTitle: "Transparency (Art. 13)",
  sourceName: "EUSAiR",
  controlTopic: "Transparency",
  countries: ["Luxembourg"],
  regulations: ["EU AI Act"],
  questions: [
    { id: "q1", order: 0, text: "First?", article: "Art. 13.1", category: "Docs" },
    { id: "q2", order: 1, text: "Second?", article: null, category: "Docs" },
    { id: "q3", order: 2, text: "Third?", article: null, category: "Logging" },
  ],
  answersByQ: { q1: "Yes, documented.", q2: "Partially." },
  scoresByQ: { q1: 5, q2: 3 },
  versionByQ: { q1: 1, q2: null },
};

describe("buildReportPayload", () => {
  it("groups consecutive categories and carries answers + score labels", () => {
    const p = buildReportPayload(base, new Date(2026, 5, 3, 10, 0));
    expect(p.groups).toHaveLength(2);
    expect(p.groups[0]).toMatchObject({ category: "Docs" });
    expect(p.groups[0].entries[0]).toMatchObject({
      text: "First?",
      article: "Art. 13.1",
      score: 5,
      scoreLabel: "Optimized",
      answer: "Yes, documented.",
    });
    // Unscored / unanswered fall back to null, not undefined.
    expect(p.groups[1].entries[0]).toMatchObject({
      score: null,
      scoreLabel: null,
      answer: null,
    });
  });

  it("computes readiness from scored questions only", () => {
    const p = buildReportPayload(base, new Date(2026, 5, 3, 10, 0));
    // 5 → 100%, 3 → 50%: 75%
    expect(p.readiness).toBe(75);
    expect(p.scoredCount).toBe(2);
    expect(p.totalQuestions).toBe(3);
  });

  it("gives coverage: the questions answered out of all of them", () => {
    const p = buildReportPayload(
      { ...base, answersByQ: { q1: "Yes, documented." }, scoresByQ: { q1: 5, q2: 3 } },
      new Date(2026, 5, 3, 10, 0),
    );
    expect(p.answeredCount).toBe(2);
    expect(p.coverage).toBe(67);
  });

  it("formats dates as dd/mm/yyyy HH:MM and exposes the full 1–5 legend", () => {
    const p = buildReportPayload(base, new Date(2026, 5, 3, 10, 0));
    expect(p.createdAt).toBe("01/06/2026 14:30");
    expect(p.closedAt).toBe("02/06/2026 09:05");
    expect(p.generatedAt).toBe("03/06/2026 10:00");
    expect(p.scoreScale).toHaveLength(5);
    expect(p.scoreScale[4]).toEqual({ value: 5, label: "Optimized" });
  });

  it("leaves closedAt null for an open draft with nothing scored", () => {
    const p = buildReportPayload(
      { ...base, status: "Draft", closedAt: null, scoresByQ: {} },
      new Date(2026, 5, 3, 10, 0),
    );
    expect(p.closedAt).toBeNull();
    expect(p.readiness).toBeNull();
    expect(p.scoredCount).toBe(0);
  });
});

// The PDF says, as the submission's page does, under which versions of the AI card the answers were given.
describe("the AI card versions in the report", () => {
  it("lists the versions the answers were given under, once each, in order", () => {
    const p = buildReportPayload(
      { ...base, versionByQ: { q1: 3, q2: 1, q3: 3 } },
      new Date(2026, 5, 3, 10, 0),
    );
    expect(p.cardVersions).toEqual([1, 3]);
  });

  it("stamps each answer as the page does: under its version, version not recorded, or nothing without an answer row", () => {
    const p = buildReportPayload(base, new Date(2026, 5, 3, 10, 0));
    expect(p.groups[0].entries[0].stamp).toBe("answered under v1");
    expect(p.groups[0].entries[1].stamp).toBe("AI card version not recorded");
    expect(p.groups[1].entries[0].stamp).toBeNull();
  });
});

// The report names the status as the page does: a closed submission is "Final".
describe("the status in the report", () => {
  it("is Final for a closed submission, and Draft for a draft", () => {
    expect(buildReportPayload(base, new Date(2026, 5, 3, 10, 0)).status).toBe("Final");
    expect(buildReportPayload({ ...base, status: "Draft", closedAt: null }, new Date(2026, 5, 3, 10, 0)).status).toBe("Draft");
  });
});
