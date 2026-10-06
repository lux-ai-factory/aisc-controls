import { describe, it, expect, vi, beforeEach } from "vitest";

// Only a package this app cannot read is "the catalogue sent a control this app cannot read" (502). A
// database that is down, or a project database that is gone (notFound), is not the catalogue's fault and
// must not be reported as such (code review 2026-10-06).
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const h = vi.hoisted(() => ({ pkg: {} as unknown, fail: null as null | (() => never) }));

vi.mock("@/lib/cataloguePackage", () => ({ fetchCataloguePackage: async () => ({ ok: true, pkg: h.pkg }) }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  writableProject: async () => ({ prisma: {} }),
}));
vi.mock("@/lib/installChecklist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/installChecklist")>()),
  installChecklist: async () => {
    if (h.fail) h.fail();
    return { checklistId: "chk", created: true };
  },
}));

import { installForCaller } from "@/lib/installControl";

const PKG = { meta: { catalogueId: "c", title: "C", sourceName: "S", controlTopic: "T" }, questions: [{ text: "q" }] };

beforeEach(() => {
  h.pkg = PKG;
  h.fail = null;
});

describe("installForCaller's errors", () => {
  it("a package it cannot read is the catalogue's: 502", async () => {
    h.pkg = { meta: { title: "no id" }, questions: [] };
    expect(await installForCaller(P1, "c")).toMatchObject({ ok: false, status: 502 });
  });

  it("a database error is not blamed on the catalogue", async () => {
    h.fail = () => { throw Object.assign(new Error("Can't reach database server"), { code: "P1001" }); };
    await expect(installForCaller(P1, "c")).rejects.toThrow(/reach database/);
  });

  it("a project database that is gone stays a 404", async () => {
    h.fail = () => { throw new Error("NEXT_NOT_FOUND"); };
    await expect(installForCaller(P1, "c")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
