// Install a checklist template sent by the catalogue (the catalogue maps its
// control into this package shape). Two parts: a pure validator/normaliser
// (unit-tested, no database) and one insert keyed on `catalogueId`. Installing
// a control the project already has changes nothing.
import type { Prisma, PrismaClient } from "@prisma/client";
import { freeSourceSlug } from "@/lib/sourceSlug";
import { countries as countryList, regulations as regulationList } from "@/data";
import { packageDigest, questionsState } from "@/lib/ledger/state";

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

/** The source's address when it is an http(s) URL, else null: the pages render it as a link, so a
 *  javascript: or data: address from a package must not reach them (the source form refuses those too). */
function webUrl(value: unknown): string | null {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(url) ? url : null;
}

/** The ids among `ids` this app knows. A catalogue may tag a control with a country or regulation this
 *  app has no entry for; kept, it would make every later review of the checklist fail ("Unknown country"),
 *  so it is left out (code review 2026-10-06). */
function known(ids: unknown, list: { id: string }[]): string[] {
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && list.some((x) => x.id === id)) : [];
}

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
    source: { name: req(meta.sourceName, "sourceName"), url: webUrl(meta.sourceUrl) },
    checklist: {
      catalogueId: req(meta.catalogueId, "catalogueId"),
      title: req(meta.title, "title"),
      controlTopic: req(meta.controlTopic, "controlTopic"),
      description: meta.description?.trim() || null,
      countryIds: known(meta.countryIds, countryList),
      regulationIds: known(meta.regulationIds, regulationList),
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

/** The caller's ledger event for a new install, written in the install's own transaction. */
export type InstallRecorder = (
  tx: Prisma.TransactionClient,
  installed: { checklistId: string; catalogueId: string; questions: number; content: InstalledContent },
) => Promise<unknown>;

/** What an install put in the project, as its event keeps it: the package's digest, the source
 *  it filed the checklist under (made by this install when it was new), and the questions with their ids,
 *  so every later answer's questionId can be tied to the question it answered. */
export type InstalledContent = {
  package_sha256: string | null;
  source: { id: string; name: string; url: string | null };
  questions: ReturnType<typeof questionsState>;
};

/** The package's digest; a package the ledger's canonical form can't hold has none (the install still runs). */
function digestOf(pkg: unknown): string | null {
  try {
    return packageDigest(pkg);
  } catch {
    return null;
  }
}

/**
 * Install a catalogue checklist into the project's database, keyed on `catalogueId`.
 * Installing a control the project already has changes nothing.
 */
export async function installChecklist(prisma: PrismaClient, pkg: unknown, record?: InstallRecorder): Promise<InstallResult> {
  const data = parseInstallPackage(pkg);
  const { catalogueId } = data.checklist;
  const findInstalled = () =>
    prisma.checklist.findUnique({ where: { catalogueId }, select: { id: true } });

  // Already in this project: leave it exactly as it is. Replacing its questions
  // would cascade into the answers already given to them.
  const existing = await findInstalled();
  if (existing) return { checklistId: existing.id, catalogueId, created: false };

  const digest = digestOf(pkg);
  let checklistId: string;
  try {
    checklistId = await createChecklist(prisma, data, digest, record);
  } catch (err) {
    // Two installs at once (a double click): both saw nothing, one created it,
    // and the other hit the unique catalogueId (or the source's unique name).
    // The second is "already installed", not an error.
    if ((err as { code?: unknown }).code !== "P2002") throw err;
    const raced = await findInstalled();
    if (raced) return { checklistId: raced.id, catalogueId, created: false };
    // Only the source collided: it exists now, so the upsert finds it.
    checklistId = await createChecklist(prisma, data, digest, record);
  }

  return { checklistId, catalogueId, created: true };
}

/** The checklist, its questions and (if new) its source, in one transaction. Returns the checklist's id. */
function createChecklist(prisma: PrismaClient, data: NormalisedChecklist, digest: string | null,
                         record?: InstallRecorder): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // An existing source of that name keeps its link (a person may have set it, and every checklist citing
    // the source shows it); the package's link only fills one that is empty. A new source gets a slug no
    // source has.
    const known = await tx.source.findUnique({ where: { name: data.source.name } });
    const source = known
      ? (known.url || !data.source.url
          ? known
          : await tx.source.update({ where: { id: known.id }, data: { url: data.source.url } }))
      : await tx.source.create({
          data: { name: data.source.name, slug: await freeSourceSlug(tx, data.source.name), url: data.source.url },
        });
    const created = await tx.checklist.create({
      data: {
        catalogueId: data.checklist.catalogueId,
        title: data.checklist.title,
        sourceId: source.id,
        controlTopic: data.checklist.controlTopic,
        description: data.checklist.description,
        countryIds: data.checklist.countryIds,
        regulationIds: data.checklist.regulationIds,
        sourceUpdatedAt: data.checklist.sourceUpdatedAt,
        questions: { create: data.questions },
      },
      select: { id: true, questions: true },
    });
    if (record) {
      await record(tx, {
        checklistId: created.id,
        catalogueId: data.checklist.catalogueId,
        questions: data.questions.length,
        content: {
          package_sha256: digest,
          source: { id: source.id, name: source.name, url: source.url },
          questions: questionsState(created.questions),
        },
      });
    }
    return created.id;
  });
}
