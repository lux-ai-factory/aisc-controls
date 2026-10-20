import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The two forms that answer a checklist: answering it the first time, and
// editing a draft.
// The state an action returned, as useActionState hands it to the form; none until a save.
const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useActionState: (fn: unknown) => [h.state, fn, false] };
});
const guarded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/useLeaveGuard", () => ({ useLeaveGuard: guarded }));
vi.mock("@/app/p/[project]/checklists/[id]/fill/actions", () => ({ submitForm: async () => undefined }));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({ saveDraft: async () => undefined }));

import FillForm from "@/app/p/[project]/checklists/[id]/fill/FillForm";
import DraftEditForm from "@/app/p/[project]/submissions/[id]/DraftEditForm";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const questions = [
  { id: "q1", text: "q1?", article: null, category: "Logging" },
  { id: "q2", text: "q2?", article: null, category: "Logging" },
  { id: "q3", text: "q3?", article: null, category: "Oversight" },
];

const fill = () =>
  renderToStaticMarkup(createElement(FillForm, { project: P1, checklistId: "chk", questions }));
const draft = () =>
  renderToStaticMarkup(
    createElement(DraftEditForm, {
      project: P1, submissionId: "s1", label: "Acme", questions, answersByQ: {}, scoresByQ: {},
    }),
  );

describe.each([["the fill form", fill], ["the draft form", draft]])("%s", (_name, render) => {
  it("groups the questions by category, each category printed once as a heading", () => {
    const html = render();
    expect(html.match(/Logging/g)).toHaveLength(1);
    expect(html.match(/Oversight/g)).toHaveLength(1);
    expect(html).toContain("<h2>Logging</h2>");
    expect(html.indexOf("q2?")).toBeLessThan(html.indexOf("<h2>Oversight</h2>"));
  });
});

describe("the fill form's save button", () => {
  it("says it saves a draft, which is what it makes", () => {
    const html = fill();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save as draft<\/button>/);
    expect(html).not.toContain("Save submission");
  });
});

describe("saving a draft", () => {
  afterEach(() => {
    h.state = undefined;
  });

  it("says nothing before the first save", () => {
    expect(draft()).not.toContain("Draft saved");
  });

  it("confirms the save with its local time", () => {
    const at = new Date(2026, 9, 18, 9, 7);
    h.state = { savedAt: at.toISOString() };
    expect(draft()).toContain("Draft saved at 09:07");
  });
});

describe.each([["the fill form", fill], ["the draft form", draft]])("%s, left with changes", (_name, render) => {
  it("asks before they are lost, and not while saving", () => {
    guarded.mockClear();
    render();
    expect(guarded.mock.calls[0].slice(0, 2)).toEqual([{ current: null }, false]);
  });
});

describe("Cancel", () => {
  /** The links among the form's buttons. */
  const actions = (html: string) => html.match(/<div class="qf-actions">[\s\S]*?<\/div>/)?.[0] ?? "";

  it("on the fill form goes back to the checklists", () => {
    expect(actions(fill())).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/checklists"[^>]*>Cancel</a>`));
  });

  it("on a draft goes back to the compiled checklists", () => {
    expect(actions(draft())).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/submissions"[^>]*>Cancel</a>`));
  });
});

// A draft is finalised, and each question is rated for its maturity on a 1-5 scale.
describe("the draft form's wording", () => {
  it("finalises the submission, never closes a checklist", () => {
    const html = draft();
    expect(html).toMatch(/<button[^>]*value="close"[^>]*>Finalise submission<\/button>/);
    expect(html).not.toContain("Save &amp; close");
  });

  it.each([["the fill form", fill], ["the draft form", draft]])("%s rates maturity, without dashes", (_name, render) => {
    const html = render();
    expect(html).toContain("<legend>Maturity (1-5)</legend>");
    expect(html).not.toContain("Readiness");
    expect(html).not.toContain("\u2014");
  });
});
