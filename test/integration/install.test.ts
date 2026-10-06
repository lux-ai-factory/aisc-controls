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
// afterwards. The SQL runs inside the throwaway Postgres container (see
// ./throwawayDb.ts), with its own env for the superuser role, so no password
// is handled here.
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

  it("a source whose slug is taken, or comes out empty, is filed under a free slug (code review 2026-10-06)", async () => {
    const db = await prismaFor(a);
    await db.source.create({ data: { name: "EU AI Act", slug: "eu-ai-act" } });
    const control = (id: string, sourceName: string) => ({
      meta: { catalogueId: id, title: id, sourceName, controlTopic: "T" }, questions: [{ text: "q" }],
    });
    expect((await installChecklist(db, control("slug-taken", "EU-AI-Act"))).created).toBe(true);
    expect((await installChecklist(db, control("no-latin-1", "日本語の規則"))).created).toBe(true);
    expect((await installChecklist(db, control("no-latin-2", "中文规则"))).created).toBe(true);
    const slugs = Object.fromEntries((await db.source.findMany()).map((s) => [s.name, s.slug]));
    expect(slugs["EU-AI-Act"]).toBe("eu-ai-act-2");
    expect(slugs["日本語の規則"]).toBe("source");
    expect(slugs["中文规则"]).toBe("source-2");
  }, 60_000);
});

describe.skipIf(!hasDb)("an install and a source that already exists (2026-10-06)", () => {
  let p: string;
  beforeAll(() => { p = makeProject(); }, 60_000);
  afterAll(() => { su(`drop database if exists ${projectDatabaseName(p)} with (force)`); });

  const withSource = (catalogueId: string, sourceName: string, sourceUrl: string) => ({
    meta: { catalogueId, title: catalogueId, sourceName, sourceUrl, controlTopic: "T" },
    questions: [{ text: "q" }],
  });

  it("keeps the link a person set on the source, which every checklist citing it shows", async () => {
    const db = await prismaFor(p);
    await db.source.create({ data: { name: "Kept source", slug: "kept-source", url: "https://set.by.hand/" } });
    expect((await installChecklist(db, withSource("keeps-url", "Kept source", "https://from.the.package/"))).created).toBe(true);
    expect((await db.source.findUniqueOrThrow({ where: { name: "Kept source" } })).url).toBe("https://set.by.hand/");
  }, 60_000);

  it("fills the link in when the source has none", async () => {
    const db = await prismaFor(p);
    await db.source.create({ data: { name: "Bare source", slug: "bare-source" } });
    await installChecklist(db, withSource("fills-url", "Bare source", "https://from.the.package/"));
    expect((await db.source.findUniqueOrThrow({ where: { name: "Bare source" } })).url).toBe("https://from.the.package/");
  }, 60_000);
});
