import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { PAGE_SIZE, pageHref, paginate } from "@/lib/pagination";

// Long lists are shown ten at a time (workshop feedback 2026-10-06): the checklist library and the
// answered checklists. The page comes from ?page=N; anything else reads as the nearest page there is.
describe("paginate", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("shows ten a page", () => {
    expect(PAGE_SIZE).toBe(10);
    const p = paginate(items, "2");
    expect(p.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(p).toMatchObject({ page: 2, totalPages: 3, total: 23 });
  });

  it("reads a missing, invalid or out-of-range page as the nearest one", () => {
    expect(paginate(items, undefined).page).toBe(1);
    expect(paginate(items, "abc").page).toBe(1);
    expect(paginate(items, "0").page).toBe(1);
    expect(paginate(items, "-4").page).toBe(1);
    expect(paginate(items, "2.5").page).toBe(1);
    const last = paginate(items, "99");
    expect(last.page).toBe(3);
    expect(last.items).toEqual([21, 22, 23]);
  });

  it("has one page when there is nothing", () => {
    expect(paginate([], "3")).toMatchObject({ items: [], page: 1, totalPages: 1, total: 0 });
  });
});

describe("pageHref", () => {
  it("keeps the other filters and drops page 1", () => {
    expect(pageHref("/p/x/checklists", { country: "lu", q: "bias", page: "3" }, 2)).toBe(
      "/p/x/checklists?country=lu&q=bias&page=2",
    );
    expect(pageHref("/p/x/checklists", { country: "lu", page: "3" }, 1)).toBe("/p/x/checklists?country=lu");
    expect(pageHref("/p/x/submissions", {}, 1)).toBe("/p/x/submissions");
    expect(pageHref("/p/x/checklists", { q: "a b", source: "" }, 2)).toBe("/p/x/checklists?q=a+b&page=2");
  });
});

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const h = vi.hoisted(() => ({ checklists: [] as unknown[], submissions: [] as unknown[] }));

vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  projectDbFor: async () => ({
    checklist: { findMany: async () => h.checklists },
    source: { findMany: async () => [] },
    submission: { findMany: async () => h.submissions, count: async () => 0 },
  }),
}));

import LibraryPage from "@/app/p/[project]/checklists/page";
import SubmissionsPage from "@/app/p/[project]/submissions/page";

type El = { type: unknown; props: Record<string, unknown> };
function walk(node: ReactNode, out: { els: El[]; text: string[] } = { els: [], text: [] }) {
  if (typeof node === "string" || typeof node === "number") out.text.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    if (typeof node.type === "function" && !(node.type as { prototype?: { render?: unknown } }).prototype?.render) {
      // render function components (the Pager) so their links are seen
      walk((node.type as (p: unknown) => ReactNode)(node.props), out);
    } else {
      out.els.push({ type: node.type, props: node.props as Record<string, unknown> });
      walk((node.props as { children?: ReactNode }).children, out);
    }
  }
  return out;
}

function checklist(i: number) {
  return {
    id: `c${i}`, title: `Checklist ${i}`, controlTopic: "Topic", description: null, countryIds: [], regulationIds: [],
    sourceId: "s1", sourceUpdatedAt: null, source: { id: "s1", name: "AESIA", citation: null, url: null },
    _count: { questions: 1, submissions: 0 },
  };
}

function submission(i: number) {
  return {
    id: `s${i}`, label: `Answer ${i}`, status: "DRAFT", version: 1, updatedAt: new Date("2026-10-06"),
    checklist: { title: "T", controlTopic: "Topic", source: { id: "s1", name: "AESIA" }, questions: [{ id: "q1" }] },
    answers: [], _count: { answers: 0 },
  };
}

const titles = (out: { text: string[] }, prefix: string) => out.text.filter((t) => new RegExp(`^${prefix}\\d+$`).test(t));
const hrefs = (out: { els: El[] }) => out.els.map((e) => e.props.href).filter((x): x is string => typeof x === "string");

describe("the checklist library shows ten a page", () => {
  beforeEach(() => {
    h.checklists = Array.from({ length: 12 }, (_, i) => checklist(i + 1));
  });

  it("shows the first ten and a link to the next page that keeps the filters", async () => {
    const out = walk(await LibraryPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({ q: "checklist" }) }));
    expect(titles(out, "Checklist ")).toHaveLength(10);
    expect(out.text.join("")).toContain("Page 1 of 2");
    expect(hrefs(out)).toContain(`/p/${P1}/checklists?q=checklist&page=2`);
  });

  it("shows the rest on page two", async () => {
    const out = walk(await LibraryPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({ page: "2" }) }));
    expect(titles(out, "Checklist ")).toEqual(["Checklist 11", "Checklist 12"]);
    expect(hrefs(out)).toContain(`/p/${P1}/checklists`);
  });

  it("shows no pager when everything fits on one page", async () => {
    h.checklists = h.checklists.slice(0, 10);
    const out = walk(await LibraryPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({}) }));
    expect(out.text.join("")).not.toContain("Page 1 of");
  });
});

describe("the answered checklists show ten a page", () => {
  beforeEach(() => {
    h.submissions = Array.from({ length: 15 }, (_, i) => submission(i + 1));
  });

  it("splits the list into pages of ten", async () => {
    const first = walk(await SubmissionsPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({}) }));
    expect(titles(first, "Answer ")).toHaveLength(10);
    expect(hrefs(first)).toContain(`/p/${P1}/submissions?page=2`);
    const second = walk(await SubmissionsPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({ page: "2" }) }));
    expect(titles(second, "Answer ")).toHaveLength(5);
    expect(second.text.join("")).toContain("Page 2 of 2");
  });
});

describe("an answered checklist shows its coverage next to its readiness", () => {
  it("counts the questions answered out of all of them", async () => {
    h.submissions = [{
      ...submission(1),
      checklist: { title: "T", controlTopic: "Topic", source: { id: "s1", name: "AESIA" },
                   questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }] },
      answers: [{ questionId: "q1", answer: "Yes", score: 4 }, { questionId: "q2", answer: null, score: 2 }],
      _count: { answers: 2 },
    }];
    const text = walk(await SubmissionsPage({ params: Promise.resolve({ project: P1 }), searchParams: Promise.resolve({}) }))
      .text.join("");
    expect(text).toContain("Coverage: 2/4 (50%)");
    expect(text).toContain("Readiness: 50%");
  });
});
