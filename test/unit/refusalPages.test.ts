import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// What a person meets when the door refuses them. A page they open while the platform cannot say who
// may be there, or that they may not open, is a page of this app (its layout, the reason, a way back and,
// when the platform did not answer, a way to try again), not a bare line of text. A form they send
// (a server action) reaches its action, which answers with the refusal in the form's own state, so the
// form keeps what was typed and says why.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const UNAVAILABLE = "Who may be here cannot be established just now.";
const READ_ONLY = "You can read this project but not change it.";

const h = vi.hoisted(() => ({ answer: { ok: true } as Record<string, unknown> }));

vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: vi.fn(async () => h.answer),
}));

import { middleware } from "@/middleware";

const page = (path: string) => new NextRequest(`http://localhost${path}`);
const action = (path: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "next-action": "7f3a9c", "content-type": "text/plain;charset=UTF-8" },
    body: "[]",
  });

/** Whether the middleware let the request go on to the page or the action. */
const passedOn = (res: Response) => res.headers.get("x-middleware-next") === "1";
/** Where the middleware rewrote or sent the request, if anywhere. */
const sentTo = (res: Response) => res.headers.get("x-middleware-rewrite") ?? res.headers.get("location") ?? "";

beforeEach(() => {
  h.answer = { ok: true };
});

describe("a page the door refuses", () => {
  it("is an app page with the reason, not a plain-text line, when the platform does not answer", async () => {
    h.answer = { ok: false, status: 503, message: UNAVAILABLE };
    const res = await middleware(page(`/p/${P1}/checklists`));
    const type = res.headers.get("content-type") ?? "";
    expect(type, "the refusal is a bare text answer").not.toMatch(/text\/plain/);
    expect(sentTo(res), "the request goes to the app's refusal page").toMatch(/refused|unavailable/i);
  });

  it("is an app page for a person who is not in the project", async () => {
    h.answer = { ok: false, status: 403, message: "You are not a member of this project." };
    const res = await middleware(page(`/p/${P1}/submissions`));
    expect(res.headers.get("content-type") ?? "", "the refusal is a bare text answer").not.toMatch(/text\/plain/);
    expect(sentTo(res), "the request goes to the app's refusal page").toMatch(/refused/i);
  });
});

describe("a request that is neither a page nor a form", () => {
  it("keeps a short answer with the refusal's status, for the code that sent it", async () => {
    h.answer = { ok: false, status: 403, message: READ_ONLY };
    const upload = new NextRequest(`http://localhost/p/${P1}/submissions/s1/questions/q1/files`, { method: "POST", body: "x" });
    const res = await middleware(upload);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(READ_ONLY);
  });
});

describe("a form the door would refuse", () => {
  it("reaches its action, which returns the refusal to the form", async () => {
    h.answer = { ok: false, status: 403, message: READ_ONLY };
    const res = await middleware(action(`/p/${P1}/checklists/chk/fill`));
    expect(passedOn(res), `the action never runs: the browser gets ${res.status} '${await res.clone().text()}'`).toBe(true);
  });

  it("reaches its action when the platform does not answer either", async () => {
    h.answer = { ok: false, status: 503, message: UNAVAILABLE };
    const res = await middleware(action(`/p/${P1}/submissions/s1`));
    expect(passedOn(res), `the action never runs: the browser gets ${res.status} '${await res.clone().text()}'`).toBe(true);
  });
});
