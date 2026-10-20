import { describe, it, expect, vi, beforeEach } from "vitest";

// The install dialog asked the platform again for every listed project
// (GET /authz/projects/{pid}) and opened a fresh Postgres connection for each, all at once. An admin's
// list is every project on the installation, so 120 projects meant 120 connections at the same moment,
// past Postgres' default max_connections, and every failed lookup was shown as "not installed".
// The list already is the caller's writable projects (the platform's /projects for that token), so the
// look-ups go straight to each project's database, at most LOOKUP_CONCURRENCY at a time.

const h = vi.hoisted(() => ({
  projects: [] as Array<{ pid: string; name: string }>,
  inFlight: 0,
  maxInFlight: 0,
  looked: [] as string[],
  admit: vi.fn(async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: false, mayWrite: true })),
}));

vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async () => ({
    ok: true,
    pkg: {
      meta: { catalogueId: "accuracy-checklist", title: "Accuracy", sourceName: "AESIA", controlTopic: "Accuracy" },
      questions: [{ text: "first" }],
    },
  }),
}));
vi.mock("@/lib/writableProjects", () => ({ writableProjects: async () => h.projects }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: h.admit,
}));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDatabaseUrl: (pid: string) => `db:${pid}`,
  lookupInstalledChecklist: async (url: string) => {
    h.inFlight += 1;
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
    await new Promise((r) => setTimeout(r, 2));
    h.inFlight -= 1;
    const pid = url.slice(3);
    h.looked.push(pid);
    return pid.endsWith("07") ? `chk-${pid}` : null;
  },
}));

import { installOptions, LOOKUP_CONCURRENCY } from "@/lib/installControl";

const pid = (n: number) => `3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a${String(n).padStart(2, "0")}`;

beforeEach(() => {
  // nothing listens there: any real connection attempt fails at once
  vi.stubEnv("PROJECT_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/{database}?schema=controls");
  vi.stubEnv("PLATFORM_URL", "http://platform.invalid");
  h.projects = Array.from({ length: 50 }, (_, i) => ({ pid: pid(i), name: `Project ${i}` }));
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.looked = [];
  h.admit.mockClear();
});

describe("the install dialog's 'already installed' look-ups", () => {
  it("run at most LOOKUP_CONCURRENCY at a time, however many projects the caller may change", async () => {
    const options = await installOptions("accuracy-checklist");
    expect(options.ok).toBe(true);
    expect(LOOKUP_CONCURRENCY).toBeLessThanOrEqual(4);
    expect(h.maxInFlight).toBeLessThanOrEqual(LOOKUP_CONCURRENCY);
    expect(h.looked.sort()).toEqual(h.projects.map((p) => p.pid).sort());
  });

  it("do not ask the platform again for each listed project", async () => {
    await installOptions("accuracy-checklist");
    expect(h.admit).not.toHaveBeenCalled();
  });

  it("still say where the control is", async () => {
    const options = await installOptions("accuracy-checklist");
    if (!options.ok) throw new Error("refused");
    expect(options.installed).toEqual({ [pid(7)]: `chk-${pid(7)}` });
  });
});
