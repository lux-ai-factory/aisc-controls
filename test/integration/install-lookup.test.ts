import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";
import { installChecklist } from "@/lib/installChecklist";
import { lookupInstalledChecklist, prismaFor, projectDatabaseUrl } from "@/lib/projectDb";

// The install dialog lists every project the person may write and says where the control is already
// installed. Opening a project database migrates it, so the list asks each database read-only and never
// migrates one (code review 2026-10-06, F10): only an install migrates the project it goes into.
const pkg = {
  meta: { catalogueId: "lookup-checklist", title: "Lookup", sourceName: "AESIA", controlTopic: "Accuracy" },
  questions: [{ text: "first" }],
};

function tablesIn(pid: string): string[] {
  return rows("select table_name from information_schema.tables where table_schema = 'controls' order by 1", pid);
}

describe.skipIf(!hasThrowawayDb)("where a control is installed, asked read-only", () => {
  let fresh: string;
  let migrated: string;
  beforeAll(() => { fresh = makeProject(); migrated = makeProject(); }, 60_000);
  afterAll(() => { dropProject(fresh); dropProject(migrated); });

  it("a project database never migrated is 'not installed', and stays unmigrated", async () => {
    const before = tablesIn(fresh);
    expect(await lookupInstalledChecklist(projectDatabaseUrl(fresh), "lookup-checklist")).toBeNull();
    expect(tablesIn(fresh)).toEqual(before);
  });

  it("a project database the control was installed into gives its checklist", async () => {
    const prisma = await prismaFor(migrated);
    const { checklistId } = await installChecklist(prisma, pkg);
    expect(await lookupInstalledChecklist(projectDatabaseUrl(migrated), "lookup-checklist")).toBe(checklistId);
    expect(await lookupInstalledChecklist(projectDatabaseUrl(migrated), "another-control")).toBeNull();
  });

  it("a project database that is not there is 'not installed'", async () => {
    expect(await lookupInstalledChecklist(projectDatabaseUrl(randomUUID()), "lookup-checklist")).toBeNull();
  });
});
