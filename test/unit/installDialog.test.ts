import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Installing a control from the catalogue is ONE dialog, like installing a test:
// what the control is, which project gets it, Cancel and Install. The page
// works out everything the dialog needs; the dialog only shows it.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const P2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const h = vi.hoisted(() => ({
  fetched: { ok: true, pkg: {} } as { ok: boolean; pkg?: unknown; reason?: string },
  projects: [] as Array<{ pid: string; name: string }> | null,
  installedIn: {} as Record<string, string>,
  redirects: [] as string[],
}));

vi.mock("@/lib/cataloguePackage", () => ({ fetchCataloguePackage: async () => h.fetched }));
vi.mock("@/lib/writableProjects", () => ({ writableProjects: async () => h.projects }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDbFor: async (pid: string) => ({
    checklist: { findUnique: async () => (h.installedIn[pid] ? { id: h.installedIn[pid] } : null) },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
}));

import InstallPage from "@/app/install/page";
import InstallDialog from "@/app/install/InstallDialog";

const PKG = {
  meta: {
    catalogueId: "accuracy-checklist",
    title: "Accuracy checklist",
    sourceName: "AESIA",
    controlTopic: "Accuracy",
    description: "Checks the accuracy of the system.",
  },
  questions: [{ text: "first" }, { text: "second" }],
};

/** Every element and string in a server-rendered tree, without rendering client components. */
function walk(node: ReactNode, out: { els: Array<{ type: unknown; props: Record<string, unknown> }>; text: string[] } = { els: [], text: [] }) {
  if (typeof node === "string" || typeof node === "number") out.text.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    out.els.push({ type: node.type, props: node.props as Record<string, unknown> });
    walk((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

async function page(search: { slug?: string; project?: string }) {
  return walk(await InstallPage({ searchParams: Promise.resolve(search) }));
}
const dialogProps = (tree: ReturnType<typeof walk>) => tree.els.find((e) => e.type === InstallDialog)?.props;

describe("the install page is one dialog", () => {
  beforeEach(() => {
    h.fetched = { ok: true, pkg: PKG };
    h.projects = [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }];
    h.installedIn = {};
    h.redirects = [];
  });

  it("gives the dialog what the control is: title, source, topic, question count, description", async () => {
    const props = dialogProps(await page({ slug: "accuracy-checklist" }));
    expect(props).toMatchObject({
      slug: "accuracy-checklist",
      control: {
        title: "Accuracy checklist",
        source: "AESIA",
        topic: "Accuracy",
        questions: 2,
        description: "Checks the accuracy of the system.",
      },
    });
  });

  it("gives the dialog the projects this person may change, preselecting the one the catalogue named", async () => {
    const props = dialogProps(await page({ slug: "accuracy-checklist", project: P2 }));
    expect(props?.projects).toEqual([{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }]);
    expect(props?.preselect).toBe(P2);
  });

  it("preselects the first project when the catalogue named none, or one this person cannot change", async () => {
    expect(dialogProps(await page({ slug: "accuracy-checklist" }))?.preselect).toBe(P1);
    expect(dialogProps(await page({ slug: "accuracy-checklist", project: "not-a-pid" }))?.preselect).toBe(P1);
  });

  it("tells the dialog in which projects the control is already installed", async () => {
    h.installedIn = { [P2]: "chk_42" };
    const props = dialogProps(await page({ slug: "accuracy-checklist" }));
    expect(props?.installed).toEqual({ [P2]: "chk_42" });
  });

  it("shows the catalogue's reason and no dialog when the control cannot be fetched", async () => {
    h.fetched = { ok: false, reason: "The catalogue has no control called “nope”." };
    const tree = await page({ slug: "nope" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toContain("The catalogue has no control called “nope”.");
  });

  it("says there is no project to install into when this person may change none", async () => {
    h.projects = [];
    const tree = await page({ slug: "accuracy-checklist" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toMatch(/cannot change any project/);
  });

  it("says the platform is not answering when the projects cannot be listed", async () => {
    h.projects = null;
    const tree = await page({ slug: "accuracy-checklist" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toMatch(/platform is not answering/);
  });

  it("asks to start from the catalogue when no control is named", async () => {
    const tree = await page({});
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toMatch(/No control was named/);
  });

  it("puts the dialog in the app's centred card", async () => {
    const tree = await page({ slug: "accuracy-checklist" });
    const classes = tree.els.map((e) => String(e.props.className ?? ""));
    expect(classes).toContain("center");
    expect(classes.some((c) => c.split(" ").includes("card"))).toBe(true);
  });
});

describe("the dialog", () => {
  const control = { title: "Accuracy checklist", source: "AESIA", topic: "Accuracy", questions: 2, description: "Checks it." };
  const render = (over: Partial<Parameters<typeof InstallDialog>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(InstallDialog, {
        slug: "accuracy-checklist",
        control,
        projects: [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }],
        preselect: P1,
        installed: {},
        ...over,
      }),
    );

  it("shows the control, one styled project dropdown, Cancel and Install", () => {
    const html = render();
    expect(html).toContain("Accuracy checklist");
    expect(html).toContain("AESIA · Accuracy · 2 questions");
    expect(html).toMatch(/<div class="field"><label[^>]*>Project<\/label><select/);
    expect(html).toMatch(/<option value="3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b" selected="">MCAS<\/option>/);
    expect(html).toMatch(/<button[^>]*class="btn ghost"[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*class="btn"[^>]*>Install<\/button>/);
  });

  it("says one question, not one questions", () => {
    expect(render({ control: { ...control, questions: 1 } })).toContain("AESIA · Accuracy · 1 question<");
  });

  it("when the chosen project already has it: says so, links to it, and offers no Install", () => {
    const html = render({ preselect: P2, installed: { [P2]: "chk_42" } });
    expect(html).toContain("Already installed in this project.");
    expect(html).toContain(`href="/p/${P2}/checklists/chk_42/fill"`);
    expect(html).not.toMatch(/type="submit"/);
  });
});

describe("installing from the dialog", () => {
  beforeEach(() => {
    h.redirects = [];
  });

  it.each(["", "abc", "../admin"])("refuses %j as a project", async (bad) => {
    const { installChosen } = await import("@/app/install/actions");
    const fd = new FormData();
    fd.set("project", bad);
    expect(await installChosen("accuracy-checklist", undefined, fd)).toEqual({ error: "Choose a project." });
  });

  it("hands the chosen project to the checked install action", async () => {
    vi.doMock("@/app/p/[project]/install/actions", () => ({
      installFromCatalogue: async (project: string, slug: string) => ({ error: `called ${project} ${slug}` }),
    }));
    vi.resetModules();
    const { installChosen } = await import("@/app/install/actions");
    const fd = new FormData();
    fd.set("project", P1);
    expect(await installChosen("accuracy-checklist", undefined, fd)).toEqual({ error: `called ${P1} accuracy-checklist` });
    vi.doUnmock("@/app/p/[project]/install/actions");
  });
});
