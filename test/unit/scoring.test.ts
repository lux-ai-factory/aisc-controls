import { describe, it, expect } from "vitest";
import { answeredCount, coverage, parseScore, readinessPercent, SCORE_VALUES } from "@/lib/scoring";

describe("parseScore", () => {
  it("accepts the 1–5 scale", () => {
    for (const n of SCORE_VALUES) {
      expect(parseScore(String(n))).toBe(n);
    }
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(parseScore("0")).toBeNull();
    expect(parseScore("6")).toBeNull();
    expect(parseScore("-1")).toBeNull();
    expect(parseScore("")).toBeNull();
    expect(parseScore("abc")).toBeNull();
  });
});

describe("readinessPercent", () => {
  it("returns null when nothing is scored", () => {
    expect(readinessPercent([])).toBeNull();
  });

  it("treats all-5 as 100%", () => {
    expect(readinessPercent([5, 5, 5])).toBe(100);
  });

  it("treats all-1, Not started, as 0%", () => {
    expect(readinessPercent([1, 1])).toBe(0);
  });

  it("puts each score on a 0-100 scale, 1 = 0% and 5 = 100%, then averages and rounds", () => {
    // (3 - 1) / 4 = 50%, (4 - 1) / 4 = 75% → 62.5 → 63%
    expect(readinessPercent([3, 4])).toBe(63);
    // 25% and 50% → 37.5 → 38%
    expect(readinessPercent([2, 3])).toBe(38);
    expect(readinessPercent([3])).toBe(50);
  });
});

describe("coverage", () => {
  it("is the share of questions answered, rounded to a percentage", () => {
    expect(coverage(2, 3)).toEqual({ answered: 2, total: 3, percent: 67 });
    expect(coverage(3, 3)).toEqual({ answered: 3, total: 3, percent: 100 });
    expect(coverage(0, 4)).toEqual({ answered: 0, total: 4, percent: 0 });
  });

  it("has no percentage for a checklist without questions", () => {
    expect(coverage(0, 0)).toEqual({ answered: 0, total: 0, percent: null });
  });
});

describe("answeredCount", () => {
  it("counts the questions with an answer or a score, once each, and only the checklist's", () => {
    const answers = [
      { questionId: "q1", answer: "Yes", score: null },
      { questionId: "q2", answer: null, score: 4 },
      { questionId: "q3", answer: null, score: null },
      { questionId: "gone", answer: "old", score: 5 },
    ];
    expect(answeredCount(answers, ["q1", "q2", "q3", "q4"])).toBe(2);
  });
});
