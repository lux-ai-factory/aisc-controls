import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The page a refused project page is shown as: the reason the platform gave, a way back to the projects
// and, when the platform did not answer, a way to try the same page again. What it shows comes from the
// door (the middleware), never from the address.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

const h = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => h.headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import RefusedPage from "@/app/refused/page";
import { REFUSAL_HEADER, refusalHeaderValue } from "@/lib/refusal";

async function render(): Promise<string> {
  return renderToStaticMarkup(createElement("div", null, await RefusedPage()));
}

beforeEach(() => {
  h.headers = new Headers();
  vi.stubEnv("LAUNCHER_URL", "http://launcher.test/");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the refused page", () => {
  it("says the platform did not answer, offers to try the page again and leads to the projects", async () => {
    h.headers.set(REFUSAL_HEADER, refusalHeaderValue({
      status: 503, message: "Who may be here cannot be established just now.", path: `/p/${P1}/checklists`,
    }));
    const html = await render();
    expect(html).toContain("Who may be here cannot be established just now.");
    expect(html).toMatch(new RegExp(`<a [^>]*href="/p/${P1}/checklists"[^>]*>Try again</a>`));
    expect(html).toMatch(/<a [^>]*href="http:\/\/launcher\.test\/"[^>]*>← Projects<\/a>/);
  });

  it("gives a person who may not open the page the platform's reason and no retry", async () => {
    h.headers.set(REFUSAL_HEADER, refusalHeaderValue({
      status: 403, message: "You are not a member of this project.", path: `/p/${P1}/submissions`,
    }));
    const html = await render();
    expect(html).toContain("You are not a member of this project.");
    expect(html).not.toContain("Try again");
    expect(html).toContain("← Projects");
  });

  it("is a not-found for a project the platform does not know", async () => {
    h.headers.set(REFUSAL_HEADER, refusalHeaderValue({ status: 404, message: "No such project.", path: "/p/x" }));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("opened on its own, says nothing it was not told and offers no retry", async () => {
    const html = await render();
    expect(html).toContain("This page cannot be shown.");
    expect(html).not.toContain("Try again");
  });

  it("never offers to try an address outside the app's projects", async () => {
    h.headers.set(REFUSAL_HEADER, refusalHeaderValue({ status: 503, message: "m", path: "//evil.test/p/x" }));
    expect(await render()).not.toContain("Try again");
  });
});
