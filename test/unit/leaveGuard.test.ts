import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guardLeaving } from "@/lib/useLeaveGuard";

// Leaving a form with changes in it loses them, so the person is asked first:
// on a link inside the app, and on closing or reloading the tab. "Changes" is
// the form's content against what it held when it opened. Nothing is asked
// while the form is being saved.
type Handler = (e: never) => void;
const h = vi.hoisted(() => ({
  window: new Map<string, Handler>(),
  document: new Map<string, { fn: Handler; capture: unknown }>(),
  answer: true,
  asked: 0,
}));

beforeEach(() => {
  h.window.clear();
  h.document.clear();
  h.answer = true;
  h.asked = 0;
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: Handler) => h.window.set(type, fn),
    removeEventListener: (type: string) => h.window.delete(type),
    confirm: () => {
      h.asked += 1;
      return h.answer;
    },
  });
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: Handler, capture: unknown) => h.document.set(type, { fn, capture }),
    removeEventListener: (type: string) => h.document.delete(type),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A click on a link, as the capture-phase listener sees it. */
function click(attrs: Record<string, string> = {}, keys: Partial<MouseEvent> = {}) {
  const link = { getAttribute: (n: string) => attrs[n] ?? null, hasAttribute: (n: string) => n in attrs };
  const e = {
    defaultPrevented: false,
    button: 0,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    ...keys,
    target: { closest: (sel: string) => (sel === "a[href]" ? link : null) },
    preventDefault() {
      e.defaultPrevented = true;
    },
  };
  h.document.get("click")!.fn(e as never);
  return e.defaultPrevented;
}

function unload() {
  const e = { prevented: false, returnValue: undefined as unknown, preventDefault() { e.prevented = true; } };
  h.window.get("beforeunload")!(e as never);
  return e.prevented;
}

function guard(saving = false) {
  let content = "opened";
  const stop = guardLeaving(() => content, () => saving);
  return { edit: (to: string) => (content = to), stop };
}

describe("the leave guard", () => {
  it("asks nothing when the form is as it opened", () => {
    guard();
    expect(click({ href: "/p/x/checklists" })).toBe(false);
    expect(unload()).toBe(false);
    expect(h.asked).toBe(0);
  });

  it("listens to clicks in the capture phase, before the link handles them", () => {
    guard();
    expect(h.document.get("click")!.capture).toBe(true);
  });

  it("asks before a link is followed from a changed form, and stays when the answer is no", () => {
    guard().edit("typed");
    h.answer = false;
    expect(click({ href: "/p/x/checklists" })).toBe(true);
    expect(h.asked).toBe(1);
  });

  it("follows the link when the answer is yes", () => {
    guard().edit("typed");
    expect(click({ href: "/p/x/checklists" })).toBe(false);
    expect(h.asked).toBe(1);
  });

  it("does not ask for a download, a new tab, or a modified click", () => {
    guard().edit("typed");
    h.answer = false;
    expect(click({ href: "/r.pdf", download: "" })).toBe(false);
    expect(click({ href: "/x", target: "_blank" })).toBe(false);
    expect(click({ href: "/x" }, { ctrlKey: true })).toBe(false);
    expect(click({ href: "/x" }, { button: 1 })).toBe(false);
    expect(h.asked).toBe(0);
  });

  it("has the browser warn before the tab is closed or reloaded with changes", () => {
    guard().edit("typed");
    expect(unload()).toBe(true);
  });

  it("asks nothing while the form is being saved", () => {
    guard(true).edit("typed");
    h.answer = false;
    expect(click({ href: "/x" })).toBe(false);
    expect(unload()).toBe(false);
    expect(h.asked).toBe(0);
  });

  it("stops listening when the form goes away", () => {
    guard().stop();
    expect(h.document.has("click")).toBe(false);
    expect(h.window.has("beforeunload")).toBe(false);
  });
});
