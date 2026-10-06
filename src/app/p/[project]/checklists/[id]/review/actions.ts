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
  // once take turns, and an answer cannot slip in between the reads and the delete: a save or a new
  // submission takes FOR SHARE on the checklist before it writes answers, so it waits for this lock.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR UPDATE`;
    const was = await tx.checklist.findUniqueOrThrow({
      where: { id: checklistId },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    // Each row names the question it edits (the form sends its id): a kept question keeps its id and its
    // answers, a reworded one too; a question no row names is removed with its own answers only; a row with
    // no id, or an id that is not one of this checklist's questions, is a new question. Replacing every
    // question as soon as one changed cascaded every answer away, closed submissions' too (2026-10-06).
    const existing = new Map(was.questions.map((q) => [q.id, q]));
    const seen = new Set<string>();
    const plan = questions.map((q, idx) => {
      // a row without an id (a form from before the ids) is the question at its place when its text is the same
      const atPlace = was.questions[idx];
      const named = q.id && existing.has(q.id) ? existing.get(q.id)! : null;
      const unnamed = !q.id && atPlace && atPlace.text === q.text ? atPlace : null;
      const candidate = named ?? unnamed;
      const kept = candidate && !seen.has(candidate.id) ? candidate : null;
      if (kept) seen.add(kept.id);
      return { row: q, order: idx + 1, kept };
    });
    const removedQuestions = was.questions.filter((q) => !seen.has(q.id));
    const added = plan.filter((p) => !p.kept);
    const reworded = plan.filter((p) => p.kept && (p.kept.text !== p.row.text || p.kept.article !== p.row.article
                                                    || p.kept.category !== p.row.category));
    const moved = plan.filter((p) => p.kept && p.kept.order !== p.order);

    if (!removedQuestions.length && !added.length && !reworded.length && !moved.length) {
      // The questions are unchanged: only the checklist's own fields change, and no answer is touched.
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

    // Only the removed questions' answers go (the database cascades them); the event keeps them, so the
    // ledger holds what the review deleted. With the ledger off they are not read.
    const removedIds = removedQuestions.map((q) => q.id);
    const removed = ledgerOn() && removedIds.length
      ? await tx.submissionAnswer.findMany({
          where: { questionId: { in: removedIds } },
          select: { submissionId: true, questionId: true, answer: true, score: true,
                    submission: { select: { status: true, version: true } } },
        })
      : [];
    const version = was.questionsVersion + 1;
    if (removedIds.length) await tx.question.deleteMany({ where: { id: { in: removedIds } } });
    // (checklistId, order) is unique: the kept questions step aside first, then take their places.
    for (const [i, p] of plan.entries()) {
      if (p.kept) await tx.question.update({ where: { id: p.kept.id }, data: { order: -(i + 1) } });
    }
    for (const p of plan) {
      if (p.kept) {
        await tx.question.update({ where: { id: p.kept.id },
                                   data: { order: p.order, text: p.row.text, article: p.row.article, category: p.row.category } });
      } else {
        await tx.question.create({ data: { checklistId, order: p.order, text: p.row.text, article: p.row.article,
                                           category: p.row.category } });
      }
    }
    const made = await tx.question.findMany({ where: { checklistId }, orderBy: { order: "asc" } });
    await tx.checklist.update({ where: { id: checklistId }, data: { ...fields, questionsVersion: version } });
    await emitEvent(tx, {
      action: "controls.checklist.questions_revised",
      itemType: "checklist",
      itemId: checklistId,
      itemVersion: version,
      details: { version, questions: questions.length, added: added.length, reworded: reworded.length,
                 removed: removedIds.length, moved: moved.length, answers_removed: removed.length,
                 closed_answers_removed: removed.filter((a) => a.submission.status === "Closed").length },
      content: {
        before: questionsState(was.questions),
        after: questionsState(made),                                   // the kept ids, and the new ones
        checklist: { before: checklistState(was), after: checklistState(fields) },
        removed_answers: removed.map((a) => ({ submission: a.submissionId, status: a.submission.status,
                                               version: a.submission.version, question: a.questionId,
                                               answer: a.answer, score: a.score })),
      },
    });
  }, { timeout: 30_000 });                                              // a big checklist's review takes time

  redirect(`/p/${project}/checklists`);
}
