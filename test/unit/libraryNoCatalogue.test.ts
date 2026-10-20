import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Checklists are installed from the project's own catalogue (the project page's step 3, "Choose tests
// and checklists"), with the catalogue's Install button: this app has no catalogue page of its own any more.
// Its install page and API stay: the catalogue's button uses them.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

const h = vi.hoisted(() => ({ checklists: [] as unknown[], admin: false }));

vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDbFor: async () => ({
    checklist: { findMany: async () => h.checklists },
    source: { findMany: async () => [] },
  }),
  callerAccess: async () => ({ ok: true, pid: "p", slug: "p", role: "editor", admin: h.admin, mayWrite: true }),
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

async function library(searchParams: Record<string, string> = {}) {
  return walk(await LibraryPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve(searchParams) }));
}

describe("checklists come from the project's catalogue, not from this app", () => {
  beforeEach(() => {
    h.checklists = [];
  });

  it("tells an empty project where checklists come from now, with a link to the project page", async () => {
    vi.stubEnv("LAUNCHER_URL", "http://launcher.test/");
    const tree = await library();
    expect(tree.text.join(" ")).toMatch(/no checklists yet/i);
    expect(tree.text.join(" ")).toContain("3. Choose tests and checklists");
    expect(tree.text.join(" ")).not.toContain("Identify tests and controls");
    expect(tree.els.some((e) => e.props.href === `http://launcher.test/p/${P1}`)).toBe(true);
  });

  it("names the list the installed checklists", async () => {
    expect((await library()).text.join(" ")).toContain("Installed checklists");
  });
});

// With the question editor on, only an administrator is shown "Edit questions".
describe("the library's Edit questions link", () => {
  const row = {
    id: "chk",
    title: "T",
    sourceId: "s",
    controlTopic: "Accuracy",
    description: null,
    countryIds: [],
    regulationIds: [],
    createdAt: new Date(),
    source: { id: "s", name: "S", citation: null, url: null },
    _count: { questions: 1, submissions: 0 },
  };
  beforeEach(() => {
    h.checklists = [row];
    vi.stubEnv("AISC_ENABLE_TEMPLATE_EDITOR", "true");
  });

  const hasLink = async () => (await library()).text.join(" ").includes("Edit questions");

  it("offers to start a new submission, never to edit a template", async () => {
    h.admin = true;
    const text = (await library()).text.join(" ");
    expect(text).toContain("Start a new submission");
    expect(text).not.toMatch(/template/i);
  });

  it("is hidden from a project editor who is not an administrator", async () => {
    h.admin = false;
    expect(await hasLink()).toBe(false);
  });

  it("is shown to an administrator", async () => {
    h.admin = true;
    expect(await hasLink()).toBe(true);
  });
});

// The question editor saves, then comes back to the list: the list says the save went through.
describe("the library after a checklist is saved", () => {
  it("says the changes were saved", async () => {
    expect((await library({ saved: "1" })).text.join(" ")).toContain("Checklist changes saved.");
  });

  it("says nothing on an ordinary visit", async () => {
    expect((await library()).text.join(" ")).not.toContain("saved");
  });
});
