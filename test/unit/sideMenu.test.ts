import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The project's pages have a menu on the left, as qualification's and control
// objectives': the two lists of checklists. The header keeps only the logo, the
// app's title and the back button, which names where it goes.
const h = vi.hoisted(() => ({ path: "/p/demo/checklists" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));

import ProjectSideMenu from "@/components/ProjectSideMenu";
import SiteHeader from "@/components/SiteHeader";

const render = (path: string) => {
  h.path = path;
  return renderToStaticMarkup(createElement(ProjectSideMenu, { project: "demo", basePath: "/controls" }));
};
/** [text, href] of each <a> with that class, whatever the attributes' order. */
const links = (html: string, cls: string) =>
  [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)]
    .filter((m) => new RegExp(`class="([^"]* )?${cls}[" ]`).test(m[1]))
    .map((m) => [m[2], m[1].match(/href="([^"]*)"/)?.[1]]);

beforeEach(() => {
  process.env.LAUNCHER_URL = "http://launcher.test/";
});

describe("the project's left menu", () => {
  it("lists the installed checklists and the submissions, then the archived ones at its bottom, and nothing else", () => {
    const html = render("/p/demo/checklists");
    expect(links(html, "cl-sidemenu-item")).toEqual([
      ["Installed checklists", "/controls/p/demo/checklists"],
      ["Submissions", "/controls/p/demo/submissions"],
      ["Archived submissions", "/controls/p/demo/submissions/archived"],
    ]);
    expect(html).not.toContain("Sources");
    expect(links(html, "cl-sidemenu-archived")).toEqual([["Archived submissions", "/controls/p/demo/submissions/archived"]]);
    expect(html.indexOf("Archived")).toBeGreaterThan(html.indexOf(">Submissions<"));
    expect(html.match(/<a /g)).toHaveLength(3);
  });

  it("marks the list the page belongs to, including the pages under it", () => {
    expect(render("/p/demo/checklists/abc").match(/aria-current="page"[^>]*>([^<]*)</)?.[1]).toBe(
      "Installed checklists",
    );
    expect(render("/p/demo/submissions/xyz/report").match(/aria-current="page"[^>]*>([^<]*)</)?.[1]).toBe(
      "Submissions",
    );
    expect(render("/p/demo/submissions/archived").match(/aria-current="page"[^>]*>([^<]*)</)?.[1]).toBe("Archived submissions");
    expect(render("/p/demo/submissions/archived").match(/aria-current="page"/g)).toHaveLength(1);
    expect(render("/p/demo")).not.toContain('aria-current="page"');
  });

  it("escapes the project in its links", () => {
    h.path = "/";
    const html = renderToStaticMarkup(createElement(ProjectSideMenu, { project: "a b", basePath: "" }));
    expect(html).toContain('href="/p/a%20b/checklists"');
  });
});

describe("the header inside a project", () => {
  it("keeps only the logo, the app's title and Back: the other links moved to the left menu", () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { project: "demo" }));
    expect(html).toMatch(/<span class="divider"><\/span><span>Checklists<\/span>/);
    // Checklists are opened from step 4, Collect evidence, so Back returns there and says so.
    expect(html).toMatch(/<a href="http:\/\/launcher\.test\/evidence\.html\?project=demo" class="btn ghost site-back">← Collect evidence<\/a>/);
    expect(html).not.toContain("← Back");
    expect(html).not.toContain("Sandbox");
    for (const gone of ["Library", "Answered checklists", ">Sources<"]) expect(html).not.toContain(gone);
  });
});
