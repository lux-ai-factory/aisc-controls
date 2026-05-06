// Programmatic ingest mirroring the UI flow.
// Usage:
//   npx tsx scripts/ingest-file.ts <path-to-file> \
//     [--title "..."] [--topic "..."] \
//     [--source "AESIA"] [--countries "ES,EU"] [--regulations "ai-act"] \
//     [--description "..."]

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ingest, IngestError } from "@/lib/ingest";
import { slugify } from "@/lib/slugify";

const DEFAULTS = {
  source: "AESIA",
  countries: ["ES"],
  regulations: ["ai-act"],
  description: "Source: https://aesia.digital.gob.es/en/guides",
};

function deriveTopic(stem: string): string {
  return stem
    .replace(/_Checklist$/i, "")
    .replace(/\s*-\s*Article\s+\d+.*$/i, "") // strip "- Article 14 AI Act"
    .replace(/\s*Evaluation Tool\s*$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgs(argv: string[]) {
  const filePath = argv[0];
  const opts = new Map<string, string>();
  for (let i = 1; i < argv.length - 1; i += 2) {
    if (argv[i].startsWith("--")) opts.set(argv[i].slice(2), argv[i + 1]);
  }
  return { filePath, opts };
}

async function upsertSource(name: string): Promise<string> {
  const trimmed = name.trim();
  const existing = await prisma.source.findUnique({
    where: { name: trimmed },
    select: { id: true },
  });
  if (existing) return existing.id;
  return (
    await prisma.source.create({
      data: { name: trimmed, slug: slugify(trimmed) || trimmed.toLowerCase() },
      select: { id: true },
    })
  ).id;
}

async function main() {
  const { filePath, opts } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    console.error(
      "Usage: npx tsx scripts/ingest-file.ts <file> [--title ...] [--topic ...] [--source ...] [--countries ID,ID] [--regulations ID,ID] [--description ...]",
    );
    process.exit(1);
  }

  const abs = path.resolve(filePath);
  const filename = path.basename(abs);
  const stem = filename.replace(/\.[^.]+$/, "");
  const title = opts.get("title") ?? stem;
  const controlTopic = opts.get("topic") ?? deriveTopic(stem);
  const sourceName = opts.get("source") ?? DEFAULTS.source;
  const countryIds = (opts.get("countries") ?? DEFAULTS.countries.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const regulationIds = (
    opts.get("regulations") ?? DEFAULTS.regulations.join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const description = opts.get("description") ?? DEFAULTS.description;

  const dup = await prisma.questionnaire.findFirst({
    where: { title },
    select: { id: true },
  });
  if (dup) {
    console.log(`SKIP: "${title}" already exists (${dup.id})`);
    return;
  }

  const buffer = await readFile(abs);
  const size = (await stat(abs)).size;
  const sourceId = await upsertSource(sourceName);

  console.log(`[${filename}] ingesting (source=${sourceName}, topic=${controlTopic})…`);
  try {
    const { id, questionCount } = await ingest({
      buffer,
      filename,
      size,
      meta: {
        title,
        sourceId,
        controlTopic,
        description,
        countryIds,
        regulationIds,
      },
    });
    console.log(`[${filename}] OK → ${id} (${questionCount} questions)`);
  } catch (err) {
    if (err instanceof IngestError) {
      console.error(`[${filename}] ${err.field ?? "error"}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
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
