import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slugify";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Human Oversight")).toBe("human-oversight");
  });

  it("strips accents and punctuation", () => {
    expect(slugify("Évaluation — Art. 14")).toBe("evaluation-art-14");
  });

  it("collapses runs of separators and trims leading/trailing hyphens", () => {
    expect(slugify("  Risk   &   Management  ")).toBe("risk-management");
  });

  it("caps length at 60 characters", () => {
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});
