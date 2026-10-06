import { describe, it, expect, vi, beforeEach } from "vitest";

// The catalogue installs a control without leaving its own page: it asks this
// app, from the browser and with the person's sign-in, what the control is and
// which projects may get it (GET), then installs it into the chosen one (POST).
// Only the catalogue's pages may ask: the online catalogue's origin, and the
// launcher's, where the stack serves the catalogue's pages for a project (plan
// 2026-10-04 P2), so no other page can install on somebody's behalf.
const CATALOGUE = "http://localhost:8102";
const LAUNCHER = "http://localhost:8100";
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const P2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const h = vi.hoisted(() => ({
  fetched: { ok: true, pkg: {} } as { ok: boolean; pkg?: unknown; reason?: string; status?: number },
  asked: [] as Array<[string, string]>,
  projects: [] as Array<{ pid: string; name: string }> | null,
  installedIn: {} as Record<string, string>,
  refused: null as { error: string } | null,
  installs: [] as Array<{ project: string }>,
}));

vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async (project: string, slug: string) => { h.asked.push([project, slug]); return h.fetched; },
}));
vi.mock("@/lib/writableProjects", () => ({ writableProjects: async () => h.projects }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  // where the control is installed is asked read-only, without opening (migrating) the database (F10)
  installedChecklistId: async (pid: string) => h.installedIn[pid] ?? null,
  writableProject: async (pid: string) => (h.refused ? { refused: h.refused } : { prisma: { pid } }),
}));
vi.mock("@/lib/installChecklist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/installChecklist")>()),
  installChecklist: async (prisma: { pid: string }) => {
    h.installs.push({ project: prisma.pid });
    return { checklistId: "chk_new", created: true };
  },
}));

import { GET, POST } from "@/app/api/install/route";

const PKG = {
  meta: { catalogueId: "accuracy-checklist", title: "Accuracy checklist", sourceName: "AESIA", controlTopic: "Accuracy" },
  questions: [{ text: "first" }, { text: "second" }],
};

function get(query: string, origin: string | null = CATALOGUE) {
  return GET(new Request(`http://localhost/controls/api/install?${query}`, { headers: origin ? { origin } : {} }));
}
function post(fields: Record<string, string>, origin: string | null = CATALOGUE) {
  return POST(
    new Request("http://localhost/controls/api/install", {
      method: "POST",
      headers: origin ? { origin } : {},
      body: new URLSearchParams(fields),
    }),
  );
}

beforeEach(() => {
  process.env.CATALOGUE_ORIGIN = CATALOGUE;
  process.env.LAUNCHER_URL = LAUNCHER + "/";
  h.fetched = { ok: true, pkg: PKG };
  h.asked = [];
  h.projects = [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }];
  h.installedIn = {};
  h.refused = null;
  h.installs = [];
});

describe("GET: what the catalogue's dialog shows", () => {
  it("answers the catalogue with the control, the projects, the preselected one and where it already is", async () => {
    h.installedIn = { [P2]: "chk_42" };
    const res = await get(`slug=accuracy-checklist&project=${P2}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      control: { title: "Accuracy checklist", source: "AESIA", topic: "Accuracy", questions: 2, description: null },
      projects: [{ pid: P1, name: "MCAS" }, { pid: P2, name: "Other" }],
      preselect: P2,
      installed: { [P2]: "chk_42" },
    });
  });

  it("lets the catalogue read the answer with the person's sign-in, and only the catalogue", async () => {
    const res = await get("slug=accuracy-checklist");
    expect(res.headers.get("access-control-allow-origin")).toBe(CATALOGUE);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toMatch(/origin/i);
  });

  it("answers the launcher's origin too: the stack's catalogue pages are there", async () => {
    const res = await get(`slug=accuracy-checklist&project=${P1}`, LAUNCHER);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(LAUNCHER);
  });

  it("shows the control as the preselected project's catalogue has it", async () => {
    await get(`slug=accuracy-checklist&project=${P2}`);
    expect(h.asked).toEqual([[P2, "accuracy-checklist"]]);
    h.asked = [];
    await get("slug=accuracy-checklist");                       // no project named: the first one
    expect(h.asked).toEqual([[P1, "accuracy-checklist"]]);
  });

  it("refuses any other origin", async () => {
    const res = await get("slug=accuracy-checklist", "http://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses every cross-origin caller when no catalogue origin is configured", async () => {
    delete process.env.CATALOGUE_ORIGIN;
    delete process.env.LAUNCHER_URL;
    expect((await get("slug=accuracy-checklist")).status).toBe(403);
    expect((await get("slug=accuracy-checklist", LAUNCHER)).status).toBe(403);
  });

  it("refuses another port of the launcher's host: an origin is scheme, host and port", async () => {
    expect((await get("slug=accuracy-checklist", "http://localhost:8188")).status).toBe(403);
  });

  it("passes on the reason and the status when the control cannot be fetched", async () => {
    h.fetched = { ok: false, status: 404, reason: "This project's catalogue has no control called “nope”." };
    const res = await get("slug=nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This project's catalogue has no control called “nope”." });
    h.fetched = { ok: false, status: 409, reason: "this project has not chosen its catalogue yet. Nothing was installed." };
    expect((await get("slug=x")).status).toBe(409);
  });

  it("says no project can get it when this person may change none: without a project there is no catalogue", async () => {
    h.projects = [];
    const res = await get("slug=accuracy-checklist");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cannot change any project/);
    expect(h.asked).toEqual([]);
  });

  it("says the platform is not answering when the projects cannot be listed", async () => {
    h.projects = null;
    const res = await get("slug=accuracy-checklist");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/platform is not answering/);
  });


  it("asks for a control when none is named", async () => {
    expect((await get("")).status).toBe(400);
  });
});

describe("POST: installing from the catalogue's dialog", () => {
  it("installs into the chosen project and says where the checklist is, inside this app", async () => {
    const res = await post({ slug: "accuracy-checklist", project: P1 });
    expect(res.status).toBe(200);
    expect(h.installs).toEqual([{ project: P1 }]);
    expect(await res.json()).toEqual({
      checklistId: "chk_new",
      created: true,
      path: `/p/${P1}/checklists/chk_new/fill?installed=new`,
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(CATALOGUE);
    expect(h.asked).toEqual([[P1, "accuracy-checklist"]]);  // from the chosen project's catalogue
  });

  it("installs from the launcher's origin", async () => {
    const res = await post({ slug: "accuracy-checklist", project: P2 }, LAUNCHER);
    expect(res.status).toBe(200);
    expect(h.installs).toEqual([{ project: P2 }]);
    expect(h.asked).toEqual([[P2, "accuracy-checklist"]]);
  });

  it("installs nothing for another origin", async () => {
    const res = await post({ slug: "accuracy-checklist", project: P1 }, "http://evil.example");
    expect(res.status).toBe(403);
    expect(h.installs).toEqual([]);
  });

  it("installs nothing without an origin: a form posted from elsewhere carries one, a script must too", async () => {
    const res = await post({ slug: "accuracy-checklist", project: P1 }, null);
    expect(res.status).toBe(403);
    expect(h.installs).toEqual([]);
  });

  it.each(["", "abc", "../admin"])("refuses %j as a project", async (bad) => {
    const res = await post({ slug: "accuracy-checklist", project: bad });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a project." });
    expect(h.installs).toEqual([]);
  });

  it("passes on the platform's refusal when this person may not change the project", async () => {
    h.refused = { error: "You can read this project but not change it." };
    const res = await post({ slug: "accuracy-checklist", project: P1 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can read this project but not change it." });
    expect(h.installs).toEqual([]);
  });

  it("installs nothing when the catalogue cannot give the control", async () => {
    h.fetched = { ok: false, status: 502, reason: "The catalogue is not answering. Nothing was installed." };
    const res = await post({ slug: "accuracy-checklist", project: P1 });
    expect(res.status).toBe(502);
    expect(h.installs).toEqual([]);
  });
});
