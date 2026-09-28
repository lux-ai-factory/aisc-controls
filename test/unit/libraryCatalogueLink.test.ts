import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactNode } from "react";

// The library leads to the catalogue, so installing needs no link pasted by hand.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

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
const catalogueLinks = (tree: ReturnType<typeof walk>) =>
  tree.els.filter((e) => e.props.href === `/p/${P1}/catalogue`);

describe("the library's way to the catalogue", () => {
  beforeEach(() => {
    h.checklists = [];
  });

  it("has an Add from catalogue button in its toolbar", async () => {
    h.checklists = [
      {
        id: "c1", title: "Accuracy", controlTopic: "Accuracy", description: null, countryIds: [], regulationIds: [],
        sourceId: "s1", sourceUpdatedAt: null, source: { id: "s1", name: "AESIA", citation: null, url: null },
        _count: { questions: 3, submissions: 0 },
      },
    ];
    const tree = await library();
    expect(catalogueLinks(tree)).toHaveLength(1);
    expect(tree.text.join(" ")).toContain("Add from catalogue");
  });

  it("points an empty project to the catalogue as well", async () => {
    const tree = await library();
    expect(catalogueLinks(tree).length).toBeGreaterThanOrEqual(2);
    expect(tree.text.join(" ")).toMatch(/no checklists yet/i);
  });
});
