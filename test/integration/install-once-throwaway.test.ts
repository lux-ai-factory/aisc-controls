import { describe, it, expect, afterAll } from "vitest";

// WP8 S8.3 (pipeline 2026-09-23, 03-specs.md): a control installed from the
// catalogue gives the project database one checklist row with
// catalogueId = <slug>; a second install is "already installed" (created:
// false) and adds nothing. Same behaviour as test/integration/install.test.ts,
// but on a throwaway Postgres (./throwawayDb.ts) instead of the live container.

import { installChecklist } from "@/lib/installChecklist";
import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";

const pkg = {
  meta: { catalogueId: "accuracy-checklist", title: "Accuracy", sourceName: "AESIA", controlTopic: "Accuracy" },
  questions: [{ text: "first" }, { text: "second" }],
};

describe.skipIf(!hasThrowawayDb)("S8.3: one control, installed once", () => {
  let project: string;
  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
  });

  it("S8.3: the first install makes one row with catalogueId, the second says already installed", async () => {
    project = makeProject();
    const db = await prismaFor(project);
    const first = await installChecklist(db, pkg);
    expect(first.created).toBe(true);
    const again = await installChecklist(db, pkg);
    expect(again).toEqual({ checklistId: first.checklistId, catalogueId: "accuracy-checklist", created: false });
    expect(rows(`SELECT "catalogueId" FROM controls.checklist`, project)).toEqual(["accuracy-checklist"]);
  }, 120_000);
});
