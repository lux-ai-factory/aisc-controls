import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// The fill form and the draft editor save without JavaScript too: as the server renders them (before the
// page's script runs, or with it off), each is a POST to its server action, so pressing Save sends the
// answers to the server and never puts them in the address of a GET. With JavaScript, onSubmit sends the
// same action and keeps what was typed when the save is refused (refusedSaveKeepsTyping.test.ts).
//
// A server action reaches the client as a reference that knows how to post itself ($$FORM_ACTION), and
// binding its arguments keeps that. These stand-ins do the same, so React renders them as Next would.
const serverAction = vi.hoisted(() => (id: string) => {
  const reference = Object.assign(async () => ({}), {
    $$FORM_ACTION: () => ({ name: `$ACTION_ID_${id}`, method: "POST", encType: "multipart/form-data", data: null }),
  });
  reference.bind = () => reference;
  return reference;
});
vi.mock("@/app/p/[project]/checklists/[id]/fill/actions", () => ({ submitForm: serverAction("fill") }));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({ saveDraft: serverAction("draft") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import FillForm from "@/app/p/[project]/checklists/[id]/fill/FillForm";
import DraftEditForm from "@/app/p/[project]/submissions/[id]/DraftEditForm";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const questions = [{ id: "q1", text: "Is every decision logged?", article: null, category: "Logging" }];

function formTag(html: string) {
  const tag = html.match(/<form[^>]*>/)?.[0];
  expect(tag, html).toBeDefined();
  return tag!;
}

describe("the checklist forms post without JavaScript", () => {
  it("the fill form posts to its server action", () => {
    const html = renderToString(createElement(FillForm, { project: P1, checklistId: "chk", questions }));
    expect(formTag(html)).toMatch(/method="POST"/i);
    expect(formTag(html)).toMatch(/enctype="multipart\/form-data"/i);
    expect(html).toContain('name="$ACTION_ID_fill"');
  });

  it("the draft editor posts to its server action", () => {
    const html = renderToString(
      createElement(DraftEditForm, {
        project: P1, submissionId: "s1", label: "Acme", questions,
        answersByQ: { q1: "Not yet" }, scoresByQ: { q1: 2 },
      }),
    );
    expect(formTag(html)).toMatch(/method="POST"/i);
    expect(html).toContain('name="$ACTION_ID_draft"');
  });
});
