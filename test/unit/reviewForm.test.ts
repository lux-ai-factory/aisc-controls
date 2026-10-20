import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The template editor's form. Its save changes the template in place, at once:
// there is no separate publish step.
const guarded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/useLeaveGuard", () => ({ useLeaveGuard: guarded }));
vi.mock("@/app/p/[project]/checklists/[id]/review/actions", () => ({ saveReviewedQuestions: async () => undefined }));

import ReviewForm from "@/app/p/[project]/checklists/[id]/review/ReviewForm";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

const render = (draftAnswers: Record<string, string[]> = {}) =>
  renderToStaticMarkup(
    createElement(ReviewForm, {
      project: P1,
      checklistId: "chk",
      meta: {
        title: "T", sourceId: "s", controlTopic: "Accuracy", description: null, sourceUpdatedAt: null,
        countryIds: [], regulationIds: [],
      },
      questions: [{ id: "q1", text: "A?", article: null, category: null }],
      countries: [],
      regulations: [],
      sources: [{ id: "s", name: "S" }],
      draftAnswers,
    }),
  );

describe("the template editor's save", () => {
  it("says it saves the checklist's changes, and promises no publish step", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save checklist changes<\/button>/);
    expect(html).not.toMatch(/publishing the template|publish checklist/i);
  });

  it("calls the checklist a checklist, never a template or a control", () => {
    const html = render();
    expect(html).toContain("Saving changes the checklist at once");
    expect(html).toContain("What is the checklist about?");
    expect(html).not.toMatch(/template|the control/i);
  });
});

describe("the template editor, left with changes", () => {
  it("asks before they are lost, and not while saving", () => {
    render();
    expect(guarded.mock.calls[0].slice(0, 2)).toEqual([{ current: null }, false]);
  });
});

describe("the template editor's Cancel", () => {
  it("goes back to the checklists, beside the save", () => {
    const actions = render().match(/<div class="qf-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(actions).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/checklists"[^>]*>Cancel</a>`));
  });
});

describe("the template editor's warning", () => {
  it("is shown beside the save when drafts would lose answers", () => {
    // q9 is answered in a draft and is no longer one of the rows
    const html = render({ q9: ["d1"] });
    const actions = html.slice(html.indexOf("Saving removes"));
    expect(actions).toMatch(/^Saving removes answers to 1 question from 1 draft\. Final submissions keep theirs\.[\s\S]*Save checklist changes/);
  });

  it("is not there when no draft would lose one", () => {
    expect(render({ q1: ["d1"] })).not.toContain("Saving removes");
  });
});
