// Export a Checklist (with its questions) into prisma/seed/examples/<slug>/
// so it gets committed and replayed by `prisma db seed` after clone.
//
// Usage:
//   npx tsx prisma/seed/export.ts <checklistId> [folderSlug]

import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../../src/lib/slugify";

const prisma = new PrismaClient();

async function main() {
  const [id, folderArg] = process.argv.slice(2);
  if (!id) {
    console.error("Usage: npx tsx prisma/seed/export.ts <checklistId> [folderSlug]");
    process.exit(1);
  }

  const q = await prisma.checklist.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" } },
      source: true,
    },
  });
  if (!q) {
    console.error(`No checklist with id ${id}`);
    process.exit(1);
  }

  const slug = folderArg || slugify(q.title) || q.id;
  const outDir = path.join(__dirname, "examples", slug);
  await mkdir(outDir, { recursive: true });

  const meta = {
    title: q.title,
    sourceName: q.source.name,
    controlTopic: q.controlTopic,
    description: q.description ?? undefined,
    sourceUpdatedAt: q.sourceUpdatedAt
      ? q.sourceUpdatedAt.toISOString().slice(0, 10)
      : undefined,
    countryIds: q.countryIds,
    regulationIds: q.regulationIds,
  };
  const questions = {
    questions: q.questions.map((qu) => ({
      text: qu.text,
      article: qu.article,
      category: qu.category,
    })),
  };

  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  await writeFile(
    path.join(outDir, "questions.json"),
    JSON.stringify(questions, null, 2) + "\n",
  );

  console.log(`Exported to ${outDir}`);
  console.log(`  ${q.questions.length} questions`);
  if (q.originalFile) {
    console.log(
      `  Source file referenced: ${q.originalFile} — drop the actual file into ${outDir} if you want to bundle it.`,
    );
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
