import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Answering a checklist always starts an empty submission. The fill page says
// so, and lists the checklist's submissions that are already there, so the
// person can open one of those instead.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";

type Sub = {
  id: string; label: string; status: string; version: number; archivedAt: Date | null; previousVersionId?: string;
};
const h = vi.hoisted(() => ({ subs: [] as Sub[], asked: [] as unknown[] }));

vi.mock("@/lib/projectDb", () => ({
  projectDbFor: async () => ({
    checklist: {
      findUnique: async () => ({
        id: "chk", title: "Logging", controlTopic: "Records", description: null, sourceUpdatedAt: null,
        countryIds: [], regulationIds: [], questions: [],
        source: { id: "s", name: "S", citation: null, url: null },
      }),
    },
    submission: {
      findMany: async (args: { where?: { checklistId?: string; archivedAt?: null; nextVersion?: { is: null } } }) => {
        h.asked.push(args);
        const superseded = new Set(h.subs.map((s) => s.previousVersionId).filter(Boolean));
        return h.subs
          .filter((s) => args.where?.archivedAt !== null || s.archivedAt === null)
          .filter((s) => args.where?.nextVersion?.is !== null || !superseded.has(s.id));
      },
    },
  }),
}));
vi.mock("@/app/p/[project]/checklists/[id]/fill/actions", () => ({ submitForm: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import FillPage from "@/app/p/[project]/checklists/[id]/fill/page";

const render = async () =>
  renderToStaticMarkup(
    await FillPage({ params: Promise.resolve({ project: P1, id: "chk" }), searchParams: Promise.resolve({}) }),
  );

beforeEach(() => {
  h.subs = [];
  h.asked = [];
});

describe("the fill page", () => {
  it("says that answering starts an empty submission", async () => {
    expect(await render()).toMatch(/starts? (a new, )?empty/i);
  });

  it("lists the checklist's submissions that are not archived, each linked", async () => {
    h.subs = [
      { id: "s1", label: "Spring run", status: "Closed", version: 1, archivedAt: null },
      { id: "s2", label: "Summer run", status: "Draft", version: 1, archivedAt: null },
      { id: "s3", label: "Old run", status: "Closed", version: 1, archivedAt: new Date() },
    ];
    const html = await render();
    expect(html).toMatch(new RegExp(`<a href="/p/${P1}/submissions/s1"[^>]*>Spring run</a>`));
    expect(html).toMatch(new RegExp(`<a href="/p/${P1}/submissions/s2"[^>]*>Summer run</a>`));
    expect(html).not.toContain("Old run");
    expect(html).toMatch(/class="status status--closed">Final</);
    expect(h.asked).toContainEqual(expect.objectContaining({ where: expect.objectContaining({ checklistId: "chk" }) }));
  });

  it("lists only the latest version of each submission, as the submissions list does", async () => {
    h.subs = [
      { id: "s1", label: "Spring run", status: "Closed", version: 1, archivedAt: null },
      { id: "s2", label: "Spring run", status: "Draft", version: 2, archivedAt: null, previousVersionId: "s1" },
    ];
    const html = await render();
    expect(html).toContain(`/p/${P1}/submissions/s2`);
    expect(html).not.toContain(`/p/${P1}/submissions/s1"`);
  });

  it("lists nothing when the checklist has no submissions yet", async () => {
    expect(await render()).not.toContain("/submissions/");
  });
});
