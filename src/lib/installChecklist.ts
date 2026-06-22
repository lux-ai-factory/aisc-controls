// Install a checklist *template* sent by the catalogue (catalogue does the
// mapping; see CATALOGUE_CONTROLS_SYNC.md). This file is deliberately thin: a
// pure validator/normaliser (unit-tested, no DB) plus one upsert keyed on
// `catalogueId` so re-installing the same control updates in place instead of
// duplicating.
import type { PrismaClient } from "@prisma/client";
import { slugify } from "@/lib/slugify";

export type InstallPackage = {
  meta: {
    catalogueId: string;
    title: string;
    sourceName: string;
    sourceUrl?: string | null;
    controlTopic: string;
    description?: string | null;
    countryIds?: string[];
    regulationIds?: string[];
    sourceUpdatedAt?: string | null;
  };
  questions: Array<{ text: string; article?: string | null; category?: string | null }>;
};

export type NormalisedChecklist = {
  source: { name: string; url: string | null };
  checklist: {
    catalogueId: string;
    title: string;
    controlTopic: string;
    description: string | null;
    countryIds: string[];
    regulationIds: string[];
    sourceUpdatedAt: Date | null;
  };
  questions: Array<{ order: number; text: string; article: string | null; category: string | null }>;
};

/** Validate and normalise a raw package into DB-shaped data. Throws on bad input. */
export function parseInstallPackage(pkg: unknown): NormalisedChecklist {
  if (!pkg || typeof pkg !== "object") throw new Error("package must be an object");
  const meta = (pkg as InstallPackage).meta;
  const questions = (pkg as InstallPackage).questions;
  if (!meta || typeof meta !== "object") throw new Error("package.meta is required");
  if (!Array.isArray(questions)) throw new Error("package.questions must be an array");

  const req = (v: unknown, name: string): string => {
    if (typeof v !== "string" || v.trim() === "") throw new Error(`meta.${name} is required`);
    return v.trim();
  };

  const sourceUpdatedAt = meta.sourceUpdatedAt ? new Date(meta.sourceUpdatedAt) : null;
  if (sourceUpdatedAt && Number.isNaN(sourceUpdatedAt.getTime())) {
    throw new Error("meta.sourceUpdatedAt is not a valid date");
  }

  return {
    source: { name: req(meta.sourceName, "sourceName"), url: meta.sourceUrl?.trim() || null },
    checklist: {
      catalogueId: req(meta.catalogueId, "catalogueId"),
      title: req(meta.title, "title"),
      controlTopic: req(meta.controlTopic, "controlTopic"),
      description: meta.description?.trim() || null,
      countryIds: Array.isArray(meta.countryIds) ? meta.countryIds : [],
      regulationIds: Array.isArray(meta.regulationIds) ? meta.regulationIds : [],
      sourceUpdatedAt,
    },
    // order is regenerated 1..N so the catalogue never has to manage it.
    questions: questions.map((q, i) => {
      if (typeof q?.text !== "string" || q.text.trim() === "") {
        throw new Error(`questions[${i}].text is required`);
      }
      return {
        order: i + 1,
        text: q.text.trim(),
        article: q.article?.trim() || null,
        category: q.category?.trim() || null,
      };
    }),
  };
}

export type InstallResult = { checklistId: string; catalogueId: string; created: boolean };

/**
 * Upsert a catalogue checklist into the local DB, keyed on `catalogueId`.
 * Idempotent: re-installing updates the template and replaces its question set.
 * User submissions reference the checklist, so they survive a re-install.
 */
export async function installChecklist(prisma: PrismaClient, pkg: unknown): Promise<InstallResult> {
  const data = parseInstallPackage(pkg);

  const source = await prisma.source.upsert({
    where: { name: data.source.name },
    update: { url: data.source.url ?? undefined },
    create: { name: data.source.name, slug: slugify(data.source.name), url: data.source.url },
  });

  const existing = await prisma.checklist.findUnique({
    where: { catalogueId: data.checklist.catalogueId },
    select: { id: true },
  });

  const checklistFields = {
    title: data.checklist.title,
    sourceId: source.id,
    controlTopic: data.checklist.controlTopic,
    description: data.checklist.description,
    countryIds: data.checklist.countryIds,
    regulationIds: data.checklist.regulationIds,
    sourceUpdatedAt: data.checklist.sourceUpdatedAt,
  };

  const checklistId = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.checklist.update({ where: { id: existing.id }, data: checklistFields });
      await tx.question.deleteMany({ where: { checklistId: existing.id } });
      await tx.question.createMany({
        data: data.questions.map((q) => ({ ...q, checklistId: existing.id })),
      });
      return existing.id;
    }
    const created = await tx.checklist.create({
      data: {
        catalogueId: data.checklist.catalogueId,
        ...checklistFields,
        questions: { create: data.questions },
      },
      select: { id: true },
    });
    return created.id;
  });

  return { checklistId, catalogueId: data.checklist.catalogueId, created: !existing };
}
