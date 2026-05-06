// Single source of truth for the ingest pipeline shared by the UI server action
// and the CLI script. parseDocument → extractQuestionsFromText → DB write.

import { prisma } from "@/lib/prisma";
import { parseDocument } from "@/lib/parseDocument";
import { extractQuestionsFromText } from "@/lib/extractQuestions";
import { regulations as regulationList } from "@/data";

export type IngestMeta = {
  title: string;
  sourceId: string;
  controlTopic: string;
  description?: string | null;
  sourceUpdatedAt?: Date | null;
  countryIds: string[];
  regulationIds: string[];
};

export type IngestInput = {
  buffer: Buffer;
  filename: string;
  size: number;
  meta: IngestMeta;
};

export type IngestResult = {
  id: string;
  questionCount: number;
};

export class IngestError extends Error {
  // `field` lets the caller route this back to the offending form input.
  // "extract" / "parse" indicate pipeline stages that aren't tied to a field.
  constructor(
    message: string,
    readonly field?: "file" | "extract" | "parse" | "duplicate",
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export async function ingest({
  buffer,
  filename,
  size,
  meta,
}: IngestInput): Promise<IngestResult> {
  const source = await prisma.source.findUnique({
    where: { id: meta.sourceId },
    select: { id: true, name: true },
  });
  if (!source) {
    throw new IngestError(
      "Selected source / authority no longer exists.",
      "parse",
    );
  }

  let documentText: string;
  try {
    const parsed = await parseDocument(buffer, filename);
    documentText = parsed.text;
  } catch (err) {
    throw new IngestError(
      err instanceof Error ? err.message : "Could not parse the document.",
      "parse",
    );
  }
  if (!documentText.trim()) {
    throw new IngestError(
      "The document appears to be empty after parsing.",
      "parse",
    );
  }

  let extracted;
  try {
    extracted = await extractQuestionsFromText(documentText, {
      sourceName: source.name,
      controlTopic: meta.controlTopic,
      regulationNames: meta.regulationIds.map(
        (id) => regulationList.find((r) => r.id === id)?.name ?? id,
      ),
    });
  } catch (err) {
    throw new IngestError(
      err instanceof Error ? err.message : "Question extraction failed.",
      "extract",
    );
  }
  if (extracted.length === 0) {
    throw new IngestError(
      "The model could not find any compliance questions in the document.",
      "extract",
    );
  }

  const created = await prisma.questionnaire.create({
    data: {
      title: meta.title,
      sourceId: meta.sourceId,
      sourceUpdatedAt: meta.sourceUpdatedAt ?? null,
      controlTopic: meta.controlTopic,
      description: meta.description?.length ? meta.description : null,
      countryIds: meta.countryIds,
      regulationIds: meta.regulationIds,
      originalFile: filename,
      originalSize: size,
      questions: {
        create: extracted.map((q, idx) => ({
          order: idx + 1,
          text: q.text,
          article: q.article,
          category: q.category,
        })),
      },
    },
    select: { id: true },
  });

  return { id: created.id, questionCount: extracted.length };
}
