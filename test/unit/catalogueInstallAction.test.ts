import { describe, it, expect, vi, beforeEach } from "vitest";

// Installing from the project's catalogue page stays on the page: the card
// turns into Installed · Open, so several checklists can be installed in a row.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

const h = vi.hoisted(() => ({
  result: { ok: true, checklistId: "chk_1", created: true, path: "/p/x/checklists/chk_1/fill?installed=new" } as
    | { ok: true; checklistId: string; created: boolean; path: string }
    | { ok: false; status: number; error: string },
  calls: [] as Array<[string, string]>,
  redirects: [] as string[],
  revalidated: [] as string[],
}));

vi.mock("@/lib/installControl", () => ({
  installForCaller: async (project: string, slug: string) => {
    h.calls.push([project, slug]);
    return h.result;
  },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { h.redirects.push(url); throw new Error("NEXT_REDIRECT"); } }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));

import { installHere } from "@/app/p/[project]/catalogue/actions";

describe("installing from the project's catalogue page", () => {
  beforeEach(() => {
    h.calls = [];
    h.redirects = [];
    h.revalidated = [];
    h.result = { ok: true, checklistId: "chk_1", created: true, path: "/p/x/checklists/chk_1/fill?installed=new" };
  });

  it("installs into this project and stays on the page, giving the checklist to open", async () => {
    const state = await installHere(P1, "accuracy-checklist", undefined);
    expect(h.calls).toEqual([[P1, "accuracy-checklist"]]);
    expect(h.redirects).toEqual([]);
    expect(state).toEqual({ installed: `/p/${P1}/checklists/chk_1/fill` });
  });

  it("refreshes the catalogue and the library, so both show it installed", async () => {
    await installHere(P1, "accuracy-checklist", undefined);
    expect(h.revalidated).toEqual(expect.arrayContaining([`/p/${P1}/catalogue`, `/p/${P1}/checklists`]));
  });

  it("gives the reason when it cannot install", async () => {
    h.result = { ok: false, status: 403, error: "You cannot change this project." };
    expect(await installHere(P1, "accuracy-checklist", undefined)).toEqual({ error: "You cannot change this project." });
    expect(h.revalidated).toEqual([]);
  });
});
