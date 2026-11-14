// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

// A save the server refuses (a blank name, a checklist gone, a revised one) answers with {error}. The page
// shows the reason above the form, and the answers and scores the person typed are still there to correct
// and save again: nothing typed is lost to a refusal. Rendered in a browser-like document, with the real
// useActionState, so React's handling of the form after an action is what is tested.
const refusal = vi.hoisted(() => ({ calls: [] as FormData[] }));
vi.mock("@/app/p/[project]/checklists/[id]/fill/actions", () => ({
  submitForm: async (_project: string, _id: string, _prev: unknown, data: FormData) => {
    refusal.calls.push(data);
    return { error: "Give this submission a name" };
  },
}));
vi.mock("@/app/p/[project]/submissions/[id]/actions", () => ({
  saveDraft: async (_project: string, _id: string, _prev: unknown, data: FormData) => {
    refusal.calls.push(data);
    return { error: "This checklist was revised: reload to answer the new version." };
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import FillForm from "@/app/p/[project]/checklists/[id]/fill/FillForm";
import DraftEditForm from "@/app/p/[project]/submissions/[id]/DraftEditForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const questions = [{ id: "q1", text: "Is every decision logged?", article: null, category: "Logging" }];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  refusal.calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function typeAndSave(submitter?: string) {
  // a name of spaces passes the browser's `required` and is refused by the server, which trims it
  const label = host.querySelector<HTMLInputElement>('input[name="label"]')!;
  if (!label.value) label.value = "   ";
  const answer = host.querySelector<HTMLTextAreaElement>('textarea[name="a:q1"]')!;
  const four = host.querySelector<HTMLInputElement>('input[name="s:q1"][value="4"]')!;
  answer.value = "Yes, in the audit log";
  four.checked = true;
  const button = submitter
    ? host.querySelector<HTMLButtonElement>(`button[value="${submitter}"]`)!
    : host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await act(async () => {
    button.click();
  });
  // the action's answer and React's work after it
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { answer, four };
}

function current() {
  return {
    error: host.querySelector(".error")?.textContent ?? null,
    answer: host.querySelector<HTMLTextAreaElement>('textarea[name="a:q1"]')!.value,
    score: host.querySelector<HTMLInputElement>('input[name="s:q1"]:checked')?.value ?? null,
  };
}

describe("a refused save keeps what was typed", () => {
  it("in the fill form", async () => {
    await act(async () => {
      root.render(createElement(FillForm, { project: P1, checklistId: "chk", questions }));
    });
    await typeAndSave();
    expect(refusal.calls).toHaveLength(1);
    expect(current()).toEqual({ error: "Give this submission a name", answer: "Yes, in the audit log", score: "4" });
  });

  it("in the draft editor, and the button pressed still says what to do", async () => {
    await act(async () => {
      root.render(
        createElement(DraftEditForm, {
          project: P1, submissionId: "s1", label: "Acme", questions,
          answersByQ: { q1: "Not yet" }, scoresByQ: { q1: 2 },
        }),
      );
    });
    await typeAndSave("close");
    expect(refusal.calls).toHaveLength(1);
    expect(refusal.calls[0].get("intent")).toBe("close");
    expect(current()).toEqual({
      error: "This checklist was revised: reload to answer the new version.",
      answer: "Yes, in the audit log",
      score: "4",
    });
  });
});
