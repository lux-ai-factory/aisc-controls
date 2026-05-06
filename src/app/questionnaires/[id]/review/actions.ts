"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  parseMeta,
  parseTags,
  parseQuestions,
  type ActionState,
} from "@/lib/questionnaireForm";

export type SaveState = ActionState;

export async function saveReviewedQuestions(
  questionnaireId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const exists = await prisma.questionnaire.findUnique({
    where: { id: questionnaireId },
    select: { id: true },
  });
  if (!exists) return { error: "Questionnaire not found." };

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

  const source = await prisma.source.findUnique({
    where: { id: meta.data.sourceId },
    select: { id: true },
  });
  if (!source) {
    return {
      fieldErrors: { sourceId: "Selected source no longer exists." },
    };
  }

  const questions = parseQuestions(formData);
  if (questions.length === 0) {
    return { fieldErrors: { questions: "Keep at least one question." } };
  }

  await prisma.$transaction([
    prisma.question.deleteMany({ where: { questionnaireId } }),
    prisma.question.createMany({
      data: questions.map((q, idx) => ({
        questionnaireId,
        order: idx + 1,
        text: q.text,
        article: q.article,
        category: q.category,
      })),
    }),
    prisma.questionnaire.update({
      where: { id: questionnaireId },
      data: {
        title: meta.data.title,
        sourceId: meta.data.sourceId,
        controlTopic: meta.data.controlTopic,
        description: meta.data.description?.length ? meta.data.description : null,
        sourceUpdatedAt: meta.data.sourceUpdatedAt
          ? new Date(meta.data.sourceUpdatedAt)
          : null,
        countryIds: tags.countryIds,
        regulationIds: tags.regulationIds,
      },
    }),
  ]);

  redirect(`/questionnaires`);
}
