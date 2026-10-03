"use server";

import { redirect } from "next/navigation";
import { writableProject } from "@/lib/projectDb";
import {
  parseMeta,
  parseTags,
  parseQuestions,
  type ActionState,
} from "@/lib/checklistForm";
import { emitEvent, ledgerOn } from "@/lib/ledger/emit";
import { checklistState, questionsState } from "@/lib/ledger/state";

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

  const fields = {
    title: meta.data.title,
    sourceId: meta.data.sourceId,
    controlTopic: meta.data.controlTopic,
    description: meta.data.description?.length ? meta.data.description : null,
    sourceUpdatedAt: meta.data.sourceUpdatedAt ? new Date(meta.data.sourceUpdatedAt) : null,
    countryIds: tags.countryIds,
    regulationIds: tags.regulationIds,
  };

  // The review and its ledger event, in one transaction. The checklist is locked first, so two reviews at
  // once take turns and an answer cannot slip in between the reads and the delete.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR UPDATE`;
    const was = await tx.checklist.findUniqueOrThrow({
      where: { id: checklistId },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    const same = was.questions.length === questions.length && was.questions.every((q, idx) =>
      q.text === questions[idx].text && q.article === questions[idx].article && q.category === questions[idx].category);

    if (same) {
      // The questions are unchanged: only the checklist's own fields change, so no question is replaced and
      // no answer goes with it.
      await tx.checklist.update({ where: { id: checklistId }, data: fields });
      await emitEvent(tx, {
        action: "controls.checklist.edited",
        itemType: "checklist",
        itemId: checklistId,
        before: checklistState(was),
        after: checklistState(fields),
      });
      return;
    }

    // Replacing the questions removes the answers given to them (closed submissions' too; the database
    // cascades): the event keeps the old questions and every answer removed, so the ledger holds what the
    // review deleted. With the ledger off they are not read.
    const removed = ledgerOn()
      ? await tx.submissionAnswer.findMany({
          where: { question: { checklistId } },
          select: { submissionId: true, questionId: true, answer: true, score: true,
                    submission: { select: { status: true, version: true } } },
        })
      : [];
    const version = was.questionsVersion + 1;
    await tx.question.deleteMany({ where: { checklistId } });
    const made = await tx.question.createManyAndReturn({
      data: questions.map((q, idx) => ({
        checklistId,
        order: idx + 1,
        text: q.text,
        article: q.article,
        category: q.category,
      })),
    });
    await tx.checklist.update({ where: { id: checklistId }, data: { ...fields, questionsVersion: version } });
    await emitEvent(tx, {
      action: "controls.checklist.questions_revised",
      itemType: "checklist",
      itemId: checklistId,
      itemVersion: version,
      details: { version, questions: questions.length, answers_removed: removed.length,
                 closed_answers_removed: removed.filter((a) => a.submission.status === "Closed").length },
      content: {
        before: questionsState(was.questions),
        after: questionsState(made),                                   // with the new ids
        checklist: { before: checklistState(was), after: checklistState(fields) },
        removed_answers: removed.map((a) => ({ submission: a.submissionId, status: a.submission.status,
                                               version: a.submission.version, question: a.questionId,
                                               answer: a.answer, score: a.score })),
      },
    });
  }, { timeout: 30_000 });                                              // a big checklist's review takes time

  redirect(`/p/${project}/checklists`);
}
