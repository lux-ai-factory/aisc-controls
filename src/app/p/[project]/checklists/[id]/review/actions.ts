"use server";

import { redirect } from "next/navigation";
import { writableProject } from "@/lib/projectDb";
import {
  parseMeta,
  parseTags,
  parseQuestions,
  type ActionState,
} from "@/lib/checklistForm";
import { emitEvent } from "@/lib/ledger/emit";

export type SaveState = ActionState;

export async function saveReviewedQuestions(
  project: string,
  checklistId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const exists = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { id: true },
  });
  if (!exists) return { error: "Checklist not found." };

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

  // The review, and its event, in one transaction (ledger phase 7). Replacing the questions removes the
  // answers given to them (closed submissions' too; the database cascades): the event keeps the old
  // questions and every answer removed, so the ledger holds what the review deleted.
  await prisma.$transaction(async (tx) => {
    const was = await tx.checklist.findUnique({
      where: { id: checklistId },
      select: { questionsVersion: true, questions: { orderBy: { order: "asc" } } },
    });
    const removed = await tx.submissionAnswer.findMany({
      where: { question: { checklistId } },
      select: { submissionId: true, questionId: true, answer: true, score: true,
                submission: { select: { status: true, version: true } } },
    });
    const version = (was?.questionsVersion ?? 1) + 1;
    await tx.question.deleteMany({ where: { checklistId } });
    await tx.question.createMany({
      data: questions.map((q, idx) => ({
        checklistId,
        order: idx + 1,
        text: q.text,
        article: q.article,
        category: q.category,
      })),
    });
    await emitEvent(tx, {
      action: "controls.checklist.questions_revised",
      itemType: "checklist",
      itemId: checklistId,
      itemVersion: version,
      details: { version, questions: questions.length, answers_removed: removed.length,
                 closed_answers_removed: removed.filter((a) => a.submission.status === "Closed").length },
      content: {
        before: (was?.questions ?? []).map((q) => ({ id: q.id, order: q.order, text: q.text, article: q.article, category: q.category })),
        after: questions.map((q, idx) => ({ order: idx + 1, text: q.text, article: q.article, category: q.category })),
        removed_answers: removed.map((a) => ({ submission: a.submissionId, status: a.submission.status,
                                               version: a.submission.version, question: a.questionId,
                                               answer: a.answer, score: a.score })),
      },
    });
    await tx.checklist.update({
      where: { id: checklistId },
      data: {
        questionsVersion: version,
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
    });
  });

  redirect(`/p/${project}/checklists`);
}
