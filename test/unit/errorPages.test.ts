import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The error and not-found pages lead back to the launcher's list of projects: the app's own root
// has no project list, it only sends you there.
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the not-found page", () => {
  it("links to the launcher's projects", () => {
    vi.stubEnv("LAUNCHER_URL", "http://launcher.test/");
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toMatch(/<a [^>]*href="http:\/\/launcher\.test\/"[^>]*>← Projects<\/a>/);
    expect(html).not.toContain("Back to your projects");
  });
});

describe("the error page", () => {
  it("offers to try again, or to go to the projects", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPage, { error: new Error("boom"), reset: () => {} }),
    );
    expect(html).toContain("Try again");
    expect(html).toMatch(/>← Projects<\/a>/);
    expect(html).not.toContain("Back to your projects");
  });
});
