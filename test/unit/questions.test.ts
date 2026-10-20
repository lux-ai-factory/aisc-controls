import { describe, it, expect } from "vitest";
import { groupByCategory } from "@/lib/questions";

const q = (id: string, category: string | null) => ({ id, category });

describe("groupByCategory", () => {
  it("returns an empty array for no items", () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it("groups consecutive items that share a category", () => {
    const groups = groupByCategory([
      q("1", "A"),
      q("2", "A"),
      q("3", "B"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].category).toBe("A");
    expect(groups[0].items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(groups[1].category).toBe("B");
  });

  it("keeps null categories as their own group", () => {
    const groups = groupByCategory([q("1", null), q("2", null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
    expect(groups[0].items).toHaveLength(2);
  });

  it("splits a category that recurs non-consecutively", () => {
    const groups = groupByCategory([q("1", "A"), q("2", "B"), q("3", "A")]);
    expect(groups.map((g) => g.category)).toEqual(["A", "B", "A"]);
  });
});
