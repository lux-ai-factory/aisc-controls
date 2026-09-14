import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../src/lib/slugify";

const prisma = new PrismaClient();

const SEED_DIR = path.join(__dirname, "seed");
const EXAMPLES_DIR = path.join(SEED_DIR, "examples");
const SOURCES_FILE = path.join(SEED_DIR, "sources.json");

type SourceEntry = {
  name: string;
  slug?: string;
  citation?: string | null;
  url?: string | null;
};

type Meta = {
  title: string;
  sourceName: string;
  controlTopic: string;
  description?: string;
  countryIds: string[];
  regulationIds: string[];
  sourceUpdatedAt?: string | null; // ISO date or YYYY-MM-DD
};

type QuestionsFile = {
  questions: Array<{
    text: string;
    article?: string | null;
    category?: string | null;
  }>;
};

async function upsertSourceFromEntry(entry: SourceEntry): Promise<void> {
  const name = entry.name.trim();
  const slug = entry.slug || slugify(name) || name.toLowerCase();
  const citation = entry.citation?.trim() || null;
  const url = entry.url?.trim() || null;
  await prisma.source.upsert({
    where: { name },
    update: { slug, citation, url },
    create: { name, slug, citation, url },
  });
}

async function getOrCreateSourceId(name: string): Promise<string> {
  const trimmed = name.trim();
  const existing = await prisma.source.findUnique({
    where: { name: trimmed },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.source.create({
    data: { name: trimmed, slug: slugify(trimmed) || trimmed.toLowerCase() },
    select: { id: true },
  });
  return created.id;
}

function parseDateOrNull(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  // 1. Sources registry — upsert citations and slugs ahead of any checklists.
  if (existsSync(SOURCES_FILE)) {
    const sources = JSON.parse(await readFile(SOURCES_FILE, "utf8")) as SourceEntry[];
    for (const s of sources) await upsertSourceFromEntry(s);
    console.log(`[sources] upserted ${sources.length}`);
  }

  if (!existsSync(EXAMPLES_DIR)) {
    console.log(`No examples directory at ${EXAMPLES_DIR} — nothing to seed.`);
    return;
  }

  const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const folder of folders) {
    const dir = path.join(EXAMPLES_DIR, folder);
    const metaPath = path.join(dir, "meta.json");
    const questionsPath = path.join(dir, "questions.json");

    if (!existsSync(metaPath) || !existsSync(questionsPath)) {
      console.log(`[${folder}] skipped — missing meta.json or questions.json`);
      continue;
    }

    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Meta;
    const qf = JSON.parse(await readFile(questionsPath, "utf8")) as QuestionsFile;

    const existing = await prisma.checklist.findFirst({
      where: { title: meta.title },
      select: { id: true },
    });
    if (existing) {
      console.log(`[${folder}] already seeded as ${existing.id}`);
      continue;
    }

    const sourceId = await getOrCreateSourceId(meta.sourceName);
    const sourceUpdatedAt = parseDateOrNull(meta.sourceUpdatedAt);

    const created = await prisma.checklist.create({
      data: {
        title: meta.title,
        sourceId,
        sourceUpdatedAt,
        controlTopic: meta.controlTopic,
        description: meta.description ?? null,
        countryIds: meta.countryIds,
        regulationIds: meta.regulationIds,
        questions: {
          create: qf.questions.map((q, idx) => ({
            order: idx + 1,
            text: q.text,
            article: q.article ?? null,
            category: q.category ?? null,
          })),
        },
      },
      select: { id: true },
    });
    console.log(`[${folder}] seeded ${created.id} (${qf.questions.length} questions)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
