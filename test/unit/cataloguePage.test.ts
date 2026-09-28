import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactNode } from "react";

// A project's own view of the catalogue: every checklist it offers, with
// Install on the ones this project does not have yet and Open on the rest.
// No link to paste and no project to pick: the project is the one you are in.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

const h = vi.hoisted(() => ({
  listed: { ok: true, controls: [] } as
    | { ok: true; controls: Array<{ slug: string; name: string; description: string | null }> }
    | { ok: false; reason: string },
  projects: [] as Array<{ pid: string; name: string }> | null,
  installed: [] as Array<{ id: string; catalogueId: string | null }>,
}));

vi.mock("@/lib/catalogueControls", () => ({ fetchCatalogueControls: async () => h.listed }));
vi.mock("@/lib/writableProjects", () => ({ writableProjects: async () => h.projects }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDbFor: async () => ({ checklist: { findMany: async () => h.installed } }),
}));

import CataloguePage from "@/app/p/[project]/catalogue/page";
import InstallButton from "@/app/p/[project]/catalogue/InstallButton";

function walk(node: ReactNode, out: { els: Array<{ type: unknown; props: Record<string, unknown> }>; text: string[] } = { els: [], text: [] }) {
  if (typeof node === "string" || typeof node === "number") out.text.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    out.els.push({ type: node.type, props: node.props as Record<string, unknown> });
    walk((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

async function page(q?: string) {
  return walk(await CataloguePage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({ q }) }));
}
const buttons = (tree: ReturnType<typeof walk>) => tree.els.filter((e) => e.type === InstallButton).map((e) => e.props);
const hrefs = (tree: ReturnType<typeof walk>) => tree.els.map((e) => e.props.href).filter(Boolean);

describe("the project's catalogue page", () => {
  beforeEach(() => {
    h.listed = {
      ok: true,
      controls: [
        { slug: "accuracy-checklist", name: "Accuracy checklist", description: "Checks accuracy." },
        { slug: "cybersecurity-checklist", name: "Cybersecurity checklist", description: null },
      ],
    };
    h.projects = [{ pid: P1, name: "Demo" }];
    h.installed = [];
  });

  it("lists every checklist the catalogue offers, with an Install for this project", async () => {
    const tree = await page();
    const text = tree.text.join(" ");
    expect(text).toContain("Accuracy checklist");
    expect(text).toContain("Checks accuracy.");
    expect(text).toContain("Cybersecurity checklist");
    expect(buttons(tree)).toEqual([
      { project: P1, slug: "accuracy-checklist", disabledReason: null },
      { project: P1, slug: "cybersecurity-checklist", disabledReason: null },
    ]);
  });

  it("offers Open instead of Install for a checklist this project already has", async () => {
    h.installed = [{ id: "chk_42", catalogueId: "accuracy-checklist" }, { id: "own", catalogueId: null }];
    const tree = await page();
    expect(buttons(tree).map((b) => b.slug)).toEqual(["cybersecurity-checklist"]);
    expect(hrefs(tree)).toContain(`/p/${P1}/checklists/chk_42/fill`);
    expect(tree.text.join(" ")).toContain("Installed");
  });

  it("disables Install, saying why, when this person may not change the project", async () => {
    h.projects = [];
    const tree = await page();
    for (const b of buttons(tree)) expect(b.disabledReason).toMatch(/cannot change this project/);
  });

  it("leaves Install to decide when the platform cannot say who may change the project", async () => {
    h.projects = null;
    for (const b of buttons(await page())) expect(b.disabledReason).toBeNull();
  });

  it("shows the catalogue's reason and no buttons when it cannot be listed", async () => {
    h.listed = { ok: false, reason: "The catalogue is not answering, so its checklists cannot be listed." };
    const tree = await page();
    expect(buttons(tree)).toEqual([]);
    expect(tree.text.join(" ")).toContain("The catalogue is not answering, so its checklists cannot be listed.");
  });

  it("filters by the search words, in the name or the description", async () => {
    expect(buttons(await page("cyber")).map((b) => b.slug)).toEqual(["cybersecurity-checklist"]);
    expect(buttons(await page("ACCURACY")).map((b) => b.slug)).toEqual(["accuracy-checklist"]);
    expect((await page("nothing-like-it")).text.join(" ")).toMatch(/No checklist in the catalogue matches/);
  });

  it("leads back to the project's library", async () => {
    expect(hrefs(await page())).toContain(`/p/${P1}/checklists`);
  });
});
