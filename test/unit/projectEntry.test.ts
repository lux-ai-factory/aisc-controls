import { describe, it, expect, vi } from "vitest";

// Opening the controls app on a project lands on its available checklists: the
// page of counters that was there is gone, and so are the Sources pages (a
// checklist's source comes with it from the catalogue when it is installed).
const h = vi.hoisted(() => ({ redirects: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

import ProjectEntry from "@/app/p/[project]/page";

describe("a project's entry", () => {
  it("goes to the available checklists", async () => {
    await expect(ProjectEntry({ params: Promise.resolve({ project: "a b" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/p/a%20b/checklists"]);
  });
});
