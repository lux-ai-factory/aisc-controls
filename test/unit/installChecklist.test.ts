import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { installChecklist, parseInstallPackage } from "@/lib/installChecklist";

const pkg = (overrides: Record<string, unknown> = {}, questions?: unknown[]) => ({
  meta: {
    catalogueId: "accuracy-checklist",
    title: "Accuracy_Checklist",
    sourceName: "AESIA",
    sourceUrl: "https://aesia.example/guides",
    controlTopic: "Accuracy",
    description: "Accuracy checklist by AESIA",
    countryIds: ["ES"],
    regulationIds: ["ai-act"],
    sourceUpdatedAt: null,
    ...overrides,
  },
  questions: questions ?? [
    { text: "first", article: "Article 15", category: "MG01" },
    { text: "second", article: null, category: "MG02" },
  ],
});

describe("parseInstallPackage", () => {
  it("normalises every field and numbers questions 1..N", () => {
    const out = parseInstallPackage(pkg());
    expect(out.source).toEqual({ name: "AESIA", url: "https://aesia.example/guides" });
    expect(out.checklist.catalogueId).toBe("accuracy-checklist");
    expect(out.checklist.title).toBe("Accuracy_Checklist");
    expect(out.checklist.controlTopic).toBe("Accuracy");
    expect(out.checklist.countryIds).toEqual(["ES"]);
    expect(out.questions.map((q) => q.order)).toEqual([1, 2]);
    expect(out.questions[0]).toEqual({ order: 1, text: "first", article: "Article 15", category: "MG01" });
    expect(out.questions[1].article).toBeNull();
  });

  it("parses an ISO sourceUpdatedAt into a Date", () => {
    const out = parseInstallPackage(pkg({ sourceUpdatedAt: "2025-01-15" }));
    expect(out.checklist.sourceUpdatedAt).toBeInstanceOf(Date);
  });

  it("defaults missing arrays to empty and blanks to null", () => {
    const out = parseInstallPackage(pkg({ countryIds: undefined, regulationIds: undefined, description: "  ", sourceUrl: "" }));
    expect(out.checklist.countryIds).toEqual([]);
    expect(out.checklist.regulationIds).toEqual([]);
    expect(out.checklist.description).toBeNull();
    expect(out.source.url).toBeNull();
  });

  it.each(["catalogueId", "title", "sourceName", "controlTopic"])(
    "throws when required meta.%s is missing",
    (field) => {
      expect(() => parseInstallPackage(pkg({ [field]: "" }))).toThrow(field);
    },
  );

  it("throws on a question with no text", () => {
    expect(() => parseInstallPackage(pkg({}, [{ text: "" }]))).toThrow(/text is required/);
  });

  it("throws when questions is not an array", () => {
    expect(() => parseInstallPackage({ meta: pkg().meta, questions: "nope" })).toThrow(/array/);
  });
});

describe("installChecklist, pressed twice at once", () => {
  const unique = () => Object.assign(new Error("Unique constraint failed on catalogueId"), { code: "P2002" });

  it("the one that lost the race says already installed, with the winner's id", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner" });
    const prisma = { checklist: { findUnique }, $transaction: vi.fn().mockRejectedValue(unique()) };
    const got = await installChecklist(prisma as unknown as PrismaClient, pkg());
    expect(got).toEqual({ checklistId: "winner", catalogueId: "accuracy-checklist", created: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("when only the source collided, tries once more and creates it", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const $transaction = vi.fn().mockRejectedValueOnce(unique()).mockResolvedValueOnce("made");
    const prisma = { checklist: { findUnique }, $transaction };
    const got = await installChecklist(prisma as unknown as PrismaClient, pkg());
    expect(got).toEqual({ checklistId: "made", catalogueId: "accuracy-checklist", created: true });
  });

  it("any other error is still an error", async () => {
    const prisma = {
      checklist: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: "P1001" })),
    };
    await expect(installChecklist(prisma as unknown as PrismaClient, pkg())).rejects.toThrow("boom");
  });
});
