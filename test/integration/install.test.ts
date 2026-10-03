import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
}));

import { hasThrowawayDb, makeProject, su } from "./throwawayDb";
import { randomUUID } from "node:crypto";
import { installChecklist } from "@/lib/installChecklist";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";

// Two project databases, made the way the platform makes them, and dropped
// afterwards. Needs PROJECT_DATABASE_URL (pointing at 127.0.0.1). The SQL is
// run inside the postgres container, using its own env for the superuser
// role, so no password is handled here.
// The live container is never used: the SQL runs in the throwaway one (ledger phase 7 review M4).
const hasDb = hasThrowawayDb;

const pkg = {
  meta: { catalogueId: "accuracy-checklist", title: "Accuracy", sourceName: "AESIA", controlTopic: "Accuracy" },
  questions: [{ text: "first" }, { text: "second" }],
};

describe.skipIf(!hasDb)("installing a control into a project", () => {
  let a: string;
  let b: string;
  beforeAll(() => { a = makeProject(); b = makeProject(); }, 60_000);
  afterAll(() => { for (const pid of [a, b]) su(`drop database if exists ${projectDatabaseName(pid)} with (force)`); });

  it("puts it in that project only", async () => {
    const result = await installChecklist(await prismaFor(a), pkg);
    expect(result.created).toBe(true);
    expect(await (await prismaFor(a)).checklist.count()).toBe(1);
    expect(await (await prismaFor(b)).checklist.count()).toBe(0);
  }, 60_000);

  it("installing it again changes nothing and keeps the answers", async () => {
    const db = await prismaFor(a);
    const checklist = await db.checklist.findFirstOrThrow({ include: { questions: true } });
    const sub = await db.submission.create({
      data: { checklistId: checklist.id, label: "answered", answers: { create: [{ questionId: checklist.questions[0].id, score: 4 }] } },
    });
    const again = await installChecklist(db, { ...pkg, questions: [{ text: "replaced" }] });
    expect(again).toEqual({ checklistId: checklist.id, catalogueId: "accuracy-checklist", created: false });
    expect(await db.submissionAnswer.count({ where: { submissionId: sub.id } })).toBe(1);
    expect((await db.question.findMany({ where: { checklistId: checklist.id } })).map((q) => q.text)).toEqual(["first", "second"]);
  }, 60_000);

  it("the other project can install the same control for itself", async () => {
    expect((await installChecklist(await prismaFor(b), pkg)).created).toBe(true);
  }, 60_000);

  it("two installs at once make one checklist, and neither fails", async () => {
    const db = await prismaFor(b);
    const racing = { ...pkg, meta: { ...pkg.meta, catalogueId: "raced-checklist", sourceName: "Raced source" } };
    const results = await Promise.all([installChecklist(db, racing), installChecklist(db, racing), installChecklist(db, racing)]);
    expect(new Set(results.map((r) => r.checklistId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.checklist.count({ where: { catalogueId: "raced-checklist" } })).toBe(1);
  }, 60_000);
});
