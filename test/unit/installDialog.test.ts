import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Installing a control from the catalogue is ONE dialog, like installing a test:
// what the control is, which project gets it, Cancel and Install. The page
// works out everything the dialog needs; the dialog only shows it.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const P2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const h = vi.hoisted(() => ({
  fetched: { ok: true, pkg: {} } as { ok: boolean; pkg?: unknown; reason?: string; status?: number },
  // Per project, over `fetched`
  fetchedFor: {} as Record<string, { ok: boolean; pkg?: unknown; reason?: string; status?: number }>,
  asked: [] as string[],
  projects: [] as Array<{ pid: string; name: string }> | null,
  installedIn: {} as Record<string, string>,
  redirects: [] as string[],
  opened: vi.fn(async () => {
    throw new Error("a project database was opened (and so migrated) to build the list");
  }),
}));

vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async (pid: string) => {
    h.asked.push(pid);
    return h.fetchedFor[pid] ?? h.fetched;
  },
}));
vi.mock("@/lib/writableProjects", () => ({ writableProjects: async () => h.projects }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  // Opening a project's database migrates it: the dialog's list must never do that.
  projectDbFor: h.opened,
  prismaFor: h.opened,
  // The "already installed" look-up, straight to each listed project's database
  projectDatabaseUrl: (pid: string) => pid,
  lookupInstalledChecklist: async (pid: string) => h.installedIn[pid] ?? null,
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
    h.fetchedFor = {};
    h.asked = [];
    h.projects = [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }];
    h.installedIn = {};
    h.redirects = [];
  });

  it("is titled as installing a checklist", async () => {
    expect((await page({ slug: "accuracy-checklist", project: P1 })).text).toContain("Install a checklist");
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

  it("lists the projects without opening, and so migrating, any project database", async () => {
    h.projects = [P1, P2, "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"].map((pid) => ({ pid, name: pid.slice(0, 4) }));
    h.installedIn = { [P2]: "chk_42" };
    h.opened.mockClear();
    const props = dialogProps(await page({ slug: "accuracy-checklist" }));
    expect(props?.installed).toEqual({ [P2]: "chk_42" });
    expect(h.opened).not.toHaveBeenCalled();
  });

  // installOptions' four refusals (fetch, no project, platform, no slug) are each asserted through
  // GET in installApi.test.ts; the page has one branch for all of them, so one row proves it.
  it("shows installOptions' refusal as text, and no dialog", async () => {
    h.fetched = { ok: false, status: 404, reason: "This project's catalogue has no checklist called “nope”." };
    const tree = await page({ slug: "nope" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toContain("This project's catalogue has no checklist called “nope”.");
  });
});

// The summary used to come from the preselected project's catalogue only. Opened by hand,
// /install?slug=x preselects the first project; if that project had not chosen its catalogue (409), the page
// said "no catalogue yet" with no picker, although every other project could take the control.
describe("when the preselected project's catalogue cannot give the control", () => {
  const P3 = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
  beforeEach(() => {
    h.fetched = { ok: true, pkg: PKG };
    h.fetchedFor = {};
    h.asked = [];
    h.projects = [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }, { pid: P3, name: "Third" }];
    h.installedIn = {};
  });

  it("a project with no catalogue yet (409) gives way to the next project, which is preselected", async () => {
    h.fetchedFor[P1] = { ok: false, status: 409, reason: "This project has no catalogue yet. Nothing was installed." };
    const props = dialogProps(await page({ slug: "accuracy-checklist" }));
    expect(props?.preselect).toBe(P2);
    expect(props?.projects).toHaveLength(3);
  });

  it("a catalogue without the control (404) gives way too", async () => {
    h.fetchedFor[P1] = { ok: false, status: 404, reason: "no such control" };
    h.fetchedFor[P2] = { ok: false, status: 409, reason: "no catalogue" };
    expect(dialogProps(await page({ slug: "accuracy-checklist" }))?.preselect).toBe(P3);
  });

  it("when no project can give it, the preselected project's refusal is shown", async () => {
    h.fetched = { ok: false, status: 404, reason: "This project's catalogue has no checklist called “nope”." };
    const tree = await page({ slug: "nope" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(tree.text.join(" ")).toContain("This project's catalogue has no checklist called “nope”.");
  });

  it("asks a bounded number of projects, however many there are", async () => {
    h.projects = Array.from({ length: 40 }, (_, i) => ({ pid: `3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a${String(i).padStart(2, "0")}`, name: `P${i}` }));
    h.fetched = { ok: false, status: 404, reason: "none" };
    await page({ slug: "nope" });
    expect(h.asked.length).toBeLessThanOrEqual(5);
  });

  it("another failure (the platform down) is not retried elsewhere", async () => {
    h.fetchedFor[P1] = { ok: false, status: 502, reason: "The catalogue is not answering. Nothing was installed." };
    const tree = await page({ slug: "accuracy-checklist" });
    expect(dialogProps(tree)).toBeUndefined();
    expect(h.asked).toEqual([P1]);
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

  it("says whose catalogue the control is shown from, when there is more than one project", () => {
    expect(render()).toContain("As MCAS’s catalogue has it.");
    expect(render({ preselect: P2 })).toContain("As Other’s catalogue has it.");
    expect(render({ projects: [{ pid: P1, name: "MCAS" }] })).not.toContain("catalogue has it");
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
