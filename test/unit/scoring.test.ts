import { describe, it, expect } from "vitest";
import { parseScore, readinessPercent, SCORE_VALUES } from "@/lib/scoring";

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

  it("treats all-1 as 20%", () => {
    expect(readinessPercent([1, 1])).toBe(20);
  });

  it("averages and rounds to a percentage", () => {
    // avg 3.5 → 70%
    expect(readinessPercent([3, 4])).toBe(70);
    // avg 2.5 → 50%
    expect(readinessPercent([2, 3])).toBe(50);
  });
});
