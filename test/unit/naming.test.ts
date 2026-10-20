import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// One name for an answered checklist wherever a person reads it: a submission. The menu, the page
// titles and the forms say so; the URLs, routes and tables keep their names.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useActionState: (fn: unknown) => [undefined, fn, false] };
});
vi.mock("@/lib/useLeaveGuard", () => ({ useLeaveGuard: () => {} }));
vi.mock("@/app/p/[project]/checklists/[id]/fill/actions", () => ({ submitForm: async () => undefined }));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({ saveDraft: async () => undefined }));
vi.mock("@/lib/submissions", () => ({ submissionsOfProject: async () => [] }));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: async () => ({ submission: { findMany: async () => [] } }),
}));

import FillForm from "@/app/p/[project]/checklists/[id]/fill/FillForm";
import DraftEditForm from "@/app/p/[project]/submissions/[id]/DraftEditForm";
import SubmissionsPage from "@/app/p/[project]/submissions/page";
import ArchivedSubmissionsPage from "@/app/p/[project]/submissions/archived/page";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const questions = [{ id: "q1", text: "q1?", article: null, category: null }];

describe("the pages that list submissions", () => {
  it("are titled Submissions and Archived submissions", async () => {
    const list = renderToStaticMarkup(await SubmissionsPage({ params: Promise.resolve({ project: P1 }) }));
    const archived = renderToStaticMarkup(await ArchivedSubmissionsPage({ params: Promise.resolve({ project: P1 }) }));
    expect(list).toContain("<h1>Submissions</h1>");
    expect(archived).toContain("<h1>Archived submissions</h1>");
    expect(list + archived).not.toMatch(/compiled|archived checklists/i);
  });
});

describe("the field that names a submission", () => {
  it.each([
    ["the fill form", () => createElement(FillForm, { project: P1, checklistId: "chk", questions })],
    ["the draft form", () => createElement(DraftEditForm, {
      project: P1, submissionId: "s1", label: "Acme", questions, answersByQ: {}, scoresByQ: {},
    })],
  ])("is called Name in %s", (_name, element) => {
    const html = renderToStaticMarkup(element());
    expect(html).toContain('<label for="label">Name</label>');
    expect(html).not.toMatch(/>Label<|Submission name/);
  });
});

// The regulations' names are shown as tags; they are written without dashes, as the rest of the text.
describe("the regulations' names", () => {
  it("have no em dash", async () => {
    const { regulations } = await import("@/data");
    expect(regulations.filter((r) => r.name.includes("—")).map((r) => r.name)).toEqual([]);
  });
});
