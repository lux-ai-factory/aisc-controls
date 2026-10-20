import { describe, it, expect } from "vitest";

import { draftLossWarning, withBlankQuestion } from "@/app/p/[project]/checklists/[id]/review/rows";

// A new row's id (its React key and its hidden q.N.id) was `new-${rows}`, so
// add, remove the first row, add gave two rows `new-3`: duplicate keys, and React may reuse the wrong row.

const row = (id: string) => ({ id, text: id, article: null, category: null });

describe("a blank question added in the review form", () => {
  it("never takes an id another row has, after a remove in between", () => {
    let rows = [row("a"), row("b"), row("c")];
    rows = withBlankQuestion(rows);
    rows = rows.slice(1); // remove the first
    rows = withBlankQuestion(rows);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is blank, and is not one of the checklist's own ids", () => {
    const rows = withBlankQuestion([row("q1")]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ text: "", article: null, category: null });
    expect(rows[1].id).not.toBe("q1");
  });
});

// Saving the template takes from drafts their answers to the questions it removes (closed submissions keep
// theirs). The editor says so before the save, with counts.
describe("the warning before a save removes drafts' answers", () => {
  const answeredInDrafts = { q1: ["d1", "d2"], q2: ["d2", "d3"], q3: ["d1"] };

  it("counts the removed questions drafts answered, and the drafts", () => {
    expect(draftLossWarning([row("q3")], answeredInDrafts)).toBe(
      "Saving removes answers to 2 questions from 3 drafts. Final submissions keep theirs.",
    );
  });

  it("says one question and one draft in the singular", () => {
    expect(draftLossWarning([row("q1"), row("q2")], answeredInDrafts)).toBe(
      "Saving removes answers to 1 question from 1 draft. Final submissions keep theirs.",
    );
  });

  it("says nothing when no draft loses an answer", () => {
    expect(draftLossWarning([row("q1"), row("q2"), row("q3")], answeredInDrafts)).toBeNull();
    expect(draftLossWarning([row("q1")], {})).toBeNull();
  });
});
