"use server";

import { redirect } from "next/navigation";
import { ingest, IngestError } from "@/lib/ingest";
import {
  parseMeta,
  parseTags,
  type ActionState,
} from "@/lib/questionnaireForm";

export type IngestState = ActionState;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function ingestQuestionnaire(
  _prev: IngestState,
  formData: FormData,
): Promise<IngestState> {
  const meta = parseMeta(formData);
  const tags = parseTags(formData);
  if (!meta.ok || !tags.ok) {
    return {
      fieldErrors: {
        ...(meta.ok ? {} : meta.fieldErrors),
        ...(tags.ok ? {} : tags.fieldErrors),
      },
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      fieldErrors: {
        file: "Upload a source document (.docx, .xlsx, .csv, .txt, .md).",
      },
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { fieldErrors: { file: "File is too large (limit 25 MB)." } };
  }

  let result;
  try {
    result = await ingest({
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      size: file.size,
      meta: {
        title: meta.data.title,
        sourceId: meta.data.sourceId,
        controlTopic: meta.data.controlTopic,
        description: meta.data.description ?? null,
        sourceUpdatedAt: meta.data.sourceUpdatedAt
          ? new Date(meta.data.sourceUpdatedAt)
          : null,
        countryIds: tags.countryIds,
        regulationIds: tags.regulationIds,
      },
    });
  } catch (err) {
    if (err instanceof IngestError) return { error: err.message };
    throw err;
  }

  redirect(`/questionnaires/${result.id}/review`);
}
