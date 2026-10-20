"use server";

import { redirect } from "next/navigation";
import { callerAccess, writableProject } from "@/lib/projectDb";
import {
  mayEditTemplate,
  templateEditorEnabled,
  TEMPLATE_EDITOR_ADMINS_ONLY,
  TEMPLATE_EDITOR_OFF,
} from "@/lib/templateEditor";
import {
  parseMeta,
  parseTags,
  parseQuestions,
  type ActionState,
} from "@/lib/checklistForm";
import { emitEvent, ledgerOn } from "@/vendor/aisc-ledger/emit";
import { checklistState, questionsState, submissionState } from "@/lib/ledger/state";

export type SaveState = ActionState;

/** An answer to a removed question, as a review's event keeps it. */
const answerRecord = (a: { submissionId: string; questionId: string | null; answer: string | null; score: number | null;
                           submission: { status: string; version: number } }) =>
  ({ submission: a.submissionId, status: a.submission.status, version: a.submission.version, question: a.questionId,
     answer: a.answer, score: a.score });

export async function saveReviewedQuestions(
  project: string,
  checklistId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  // Off, the editor refuses (the shape of any refused write), before the database or the ledger is touched.
  if (!templateEditorEnabled()) return { error: TEMPLATE_EDITOR_OFF };
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  // On, it is for administrators only, whatever their role in the project.
  if (!mayEditTemplate(await callerAccess(project))) return { error: TEMPLATE_EDITOR_ADMINS_ONLY };
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
    // question as soon as one changed would cascade every answer away, closed submissions' too.
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

    // A closed submission is frozen: its answers to removed questions stay, with the wording they keep, and only
    // lose their link to the question. A draft follows the template and loses them. Closed answers that keep no
    // wording yet (closed before it was kept) take it now, before the questions change under them.
    const removedIds = removedQuestions.map((q) => q.id);
    await tx.$executeRaw`
      UPDATE controls.submission_answer a
         SET question_text = q.text, question_article = q.article, question_category = q.category,
             question_order = q."order"
        FROM controls.checklist_question q, controls.submission s
       WHERE q.id = a."questionId" AND s.id = a."submissionId" AND q."checklistId" = ${checklistId}
         AND s.status = 'Closed' AND a.question_text IS NULL`;
    // The event keeps the drafts' answers it deletes and the closed ones it leaves, so the ledger holds both.
    // With the ledger off they are not read.
    const touched = ledgerOn() && removedIds.length
      ? await tx.submissionAnswer.findMany({
          where: { questionId: { in: removedIds } },
          select: { submissionId: true, questionId: true, answer: true, score: true,
                    submission: { select: { status: true, version: true } } },
        })
      : [];
    const removed = touched.filter((a) => a.submission.status === "Draft");
    const left = touched.filter((a) => a.submission.status !== "Draft");
    // Each draft that loses answers records it: its next event's `before` is read without them, so without this
    // event the ledger's verifier would see a break in its chain (a false tamper alarm). Its state is read
    // here, before the delete, as the save and creation events build it.
    const losing = [...new Set(removed.map((a) => a.submissionId))].sort();
    const lost = losing.length
      ? await tx.submission.findMany({
          where: { id: { in: losing } },
          orderBy: { id: "asc" },
          select: { id: true, label: true, status: true,
                    answers: { select: { questionId: true, answer: true, score: true } } },
        })
      : [];
    const version = was.questionsVersion + 1;
    if (removedIds.length) {
      await tx.submissionAnswer.deleteMany({ where: { questionId: { in: removedIds }, submission: { status: "Draft" } } });
      await tx.question.deleteMany({ where: { id: { in: removedIds } } });  // the closed answers stay, unlinked
    }
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
                 closed_answers_removed: 0 },                                   // closed submissions keep theirs
      content: {
        before: questionsState(was.questions),
        after: questionsState(made),                                   // the kept ids, and the new ones
        checklist: { before: checklistState(was), after: checklistState(fields) },
        removed_answers: removed.map(answerRecord),
        kept_answers: left.map(answerRecord),
      },
    });
    const gone = new Set<string | null>(removedIds);
    for (const sub of lost) {
      await emitEvent(tx, {
        action: "controls.submission.answers_removed",
        itemType: "submission",
        itemId: sub.id,
        details: { checklist: checklistId, version,
                   answers_removed: sub.answers.filter((a) => gone.has(a.questionId)).length },
        before: submissionState(sub.label, sub.status, sub.answers),
        after: submissionState(sub.label, sub.status, sub.answers.filter((a) => !gone.has(a.questionId))),
      });
    }
  }, { timeout: 30_000 });                                              // a big checklist's review takes time

  // The list says the changes were saved, as the fill page says an install went through.
  redirect(`/p/${project}/checklists?saved=1`);
}
