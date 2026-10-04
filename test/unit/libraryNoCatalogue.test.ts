import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactNode } from "react";

// Checklists are installed from the project's own catalogue (the project page's "Identify tests and
// controls"), with the catalogue's Install button: this app has no catalogue page of its own any more
// (aisc docs/superpowers/control-install-2026-10-04/01-plan.md P5). Its install page and API stay: the
// catalogue's button uses them.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const ROOT = join(__dirname, "..", "..");

const h = vi.hoisted(() => ({ checklists: [] as unknown[] }));

vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDbFor: async () => ({
    checklist: { findMany: async () => h.checklists },
    source: { findMany: async () => [] },
  }),
}));

import LibraryPage from "@/app/p/[project]/checklists/page";

function walk(node: ReactNode, out: { els: Array<{ props: Record<string, unknown> }>; text: string[] } = { els: [], text: [] }) {
  if (typeof node === "string" || typeof node === "number") out.text.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    out.els.push({ props: node.props as Record<string, unknown> });
    walk((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

async function library() {
  return walk(await LibraryPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({}) }));
}

describe("checklists come from the project's catalogue, not from this app", () => {
  beforeEach(() => {
    h.checklists = [];
  });

  it("has no catalogue page of its own, and no list of the catalogue's controls", () => {
    expect(existsSync(join(ROOT, "src/app/p/[project]/catalogue"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/catalogueControls.ts"))).toBe(false);
  });

  it("keeps the install page and API the catalogue's Install button uses", () => {
    for (const kept of ["src/app/install/page.tsx", "src/app/api/install/route.ts", "src/app/p/[project]/install/actions.ts"]) {
      expect(existsSync(join(ROOT, kept)), kept).toBe(true);
    }
  });

  it("offers no Add from catalogue in the library", async () => {
    h.checklists = [
      {
        id: "c1", title: "Accuracy", controlTopic: "Accuracy", description: null, countryIds: [], regulationIds: [],
        sourceId: "s1", sourceUpdatedAt: null, source: { id: "s1", name: "AESIA", citation: null, url: null },
        _count: { questions: 3, submissions: 0 },
      },
    ];
    const tree = await library();
    expect(tree.text.join(" ")).not.toContain("Add from catalogue");
    expect(tree.els.filter((e) => String(e.props.href ?? "").includes("/catalogue"))).toEqual([]);
  });

  it("tells an empty project where checklists come from now", async () => {
    const tree = await library();
    expect(tree.text.join(" ")).toMatch(/no checklists yet/i);
    expect(tree.text.join(" ")).toContain("Identify tests and controls");
  });
});
