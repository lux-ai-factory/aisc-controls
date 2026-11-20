"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writableProject } from "@/lib/projectDb";
import type { PrismaClient, SubmissionAnswer } from "@prisma/client";
import { parseAnswers, REVISED, type ParsedAnswer } from "@/lib/checklistForm";
import { latestVersion } from "@/lib/systemVersion";
import { emitEvent } from "@/vendor/aisc-ledger/emit";
import { submissionState } from "@/lib/ledger/state";
import { carryProofFiles } from "@/lib/proofFiles";

// savedAt: when a save went through (an ISO time), for the form to confirm it.
export type ActionState = { error?: string; savedAt?: string } | undefined;

/** Every page of an answered checklist hangs off its project. The project is
 *  bound by the client, which is why each action checks it with the platform. */
const inProject = (project: string) => `/p/${project}`;

/**
 * The submission with its checklist's question ids, or null.
 *
 * The database is the project, so an id looked up on its own can only ever
 * reach into this project's own database.
 */
async function loadSubmission(prisma: PrismaClient, submissionId: string) {
  return prisma.submission.findUnique({
    where: { id: submissionId },
    include: { checklist: { include: { questions: { select: { id: true } } } } },
  });
}

/** Whether an answer is exactly the one already stored for its question. */
function isUnchanged(answer: ParsedAnswer, before: SubmissionAnswer | undefined): before is SubmissionAnswer {
  return before !== undefined && before.answer === answer.answer && before.score === answer.score;
}

/** An answer given again as it is stored, whose stored answer has no card version stamp. */
function isUnstamped(answer: ParsedAnswer, before: SubmissionAnswer | undefined): boolean {
  return isUnchanged(answer, before) && before.systemVersionPid === null;
}

/** A unique key two requests raced for (Prisma's P2002). */
const isUniqueClash = (err: unknown) => (err as { code?: unknown } | null)?.code === "P2002";

/** Every page that lists or shows this submission, after it moves in or out of the archive. */
function revalidateSubmissionPages(project: string, submissionId: string) {
  const base = inProject(project);
  revalidatePath(`${base}/submissions/${submissionId}`);
  revalidatePath(`${base}/submissions`);
  revalidatePath(`${base}/submissions/archived`);
}

export async function saveDraft(
  project: string,
  submissionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const sub = await loadSubmission(prisma, submissionId);
  if (!sub) return { error: "Submission not found." };
  if (sub.status !== "Draft") {
    return { error: "Only draft submissions can be edited. Amend it first." };
  }

  const validIds = new Set(sub.checklist.questions.map((q) => q.id));
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return { error: "Name cannot be empty." };
  const shouldClose = formData.get("intent") === "close";

  // Each answer carries the card version that was the latest when it was
  // answered. An unchanged answer keeps its old stamp; only a new or changed one
  // is stamped now, and an unchanged one that has no stamp (it was given before
  // the card had a version) takes the latest version's, keeping when it was given:
  // a report reads only the answers stamped with its version. "Unchanged" is
  // decided against the answers read under the lock (another tab may have saved
  // since the page read them), and the latest version is read in the same
  // transaction, from the project's own database.
  const parsed = parseAnswers(formData, validIds);

  const saved = await prisma.$transaction(async (tx) => {
    // A review of the checklist locks it to replace its questions: this waits for it, and refuses an answer
    // to a question it removed rather than failing on the foreign key.
    const [checklist] = await tx.$queryRaw<{ questions_version: number }[]>`
      SELECT questions_version FROM controls.checklist WHERE id = ${sub.checklistId} FOR SHARE`;
    const current = new Map((await tx.question.findMany({ where: { checklistId: sub.checklistId } })).map((q) => [q.id, q]));
    if (parsed.some((a) => !current.has(a.questionId))) return "revised" as const;
    // The draft is locked and read again: one closed in another tab since the reads above is refused, not
    // rewritten, and the answers it replaces, read under the lock, are its event's `before`.
    const [now] = await tx.$queryRaw<{ label: string; status: string }[]>`
      SELECT label, status::text AS status FROM controls.submission WHERE id = ${submissionId} FOR UPDATE`;
    if (!now || now.status !== "Draft") return "closed" as const;
    const replaced = await tx.submissionAnswer.findMany({ where: { submissionId } });
    const old = new Map(replaced.map((a) => [a.questionId, a]));
    const known = parsed.some((a) => isUnstamped(a, old.get(a.questionId)) || !isUnchanged(a, old.get(a.questionId)))
      ? await latestVersion(tx)
      : null;
    const answeredAt = new Date();
    const rows = parsed.map((answer) => {
      const before = old.get(answer.questionId);
      const stamp = isUnchanged(answer, before)
        ? before.systemVersionPid === null && known
          ? {
              systemVersionPid: known.pid,
              systemVersionNumber: known.number,
              systemCardRevision: known.revision,
              answeredAt: before.answeredAt,
            }
          : {
              systemVersionPid: before.systemVersionPid,
              systemVersionNumber: before.systemVersionNumber,
              systemCardRevision: before.systemCardRevision,
              answeredAt: before.answeredAt,
            }
        : {
            systemVersionPid: known?.pid ?? null,
            systemVersionNumber: known?.number ?? null,
            systemCardRevision: known?.revision ?? null,
            answeredAt,
          };
      // Closing freezes the question as it is now beside its answer; a draft follows the template instead.
      const question = current.get(answer.questionId)!;
      const asked = shouldClose
        ? { questionText: question.text, questionArticle: question.article, questionCategory: question.category,
            questionOrder: question.order }
        : {};
      return { submissionId, ...answer, ...stamp, ...asked };
    });
    const after = submissionState(label, shouldClose ? "Closed" : "Draft", rows);
    await tx.submission.update({
      where: { id: submissionId },
      data: shouldClose
        ? { label, status: "Closed", closedAt: new Date(), questionsVersion: checklist.questions_version }
        : { label },
    });
    // Each answer keeps its row, and so the files linked to it: a new one is made, a changed one updated, and
    // one no longer given is deleted, unless files are linked to it, which keeps it with no answer.
    for (const row of rows) {
      const before = old.get(row.questionId);
      if (!before) await tx.submissionAnswer.create({ data: row });
      else if (shouldClose || !isUnchanged(row, before) || row.systemVersionPid !== before.systemVersionPid) {
        await tx.submissionAnswer.update({ where: { id: before.id }, data: row });
      }
    }
    const given = new Set(rows.map((r) => r.questionId));
    const dropped = replaced.filter((a) => a.questionId !== null && !given.has(a.questionId));
    const holdingFiles = new Set((await tx.submissionAnswerFile.findMany({
      where: { answerId: { in: dropped.map((a) => a.id) } }, select: { answerId: true },
    })).map((f) => f.answerId));
    const gone = dropped.filter((a) => !holdingFiles.has(a.id)).map((a) => a.id);
    if (gone.length > 0) await tx.submissionAnswer.deleteMany({ where: { id: { in: gone } } });
    for (const a of dropped.filter((d) => holdingFiles.has(d.id))) {
      const question = current.get(a.questionId as string);
      const asked = shouldClose && question
        ? { questionText: question.text, questionArticle: question.article, questionCategory: question.category,
            questionOrder: question.order }
        : {};
      // no longer answered: no answer, and no stamp saying under which card version it was given
      await tx.submissionAnswer.update({
        where: { id: a.id },
        data: { answer: null, score: null, systemVersionPid: null, systemVersionNumber: null, systemCardRevision: null,
                answeredAt: null, ...asked },
      });
    }
    await emitEvent(tx, {
      action: shouldClose ? "controls.submission.closed" : "controls.submission.draft_saved",
      itemType: "submission",
      itemId: submissionId,
      details: shouldClose ? { score: rows.reduce((n, r) => n + (r.score ?? 0), 0) } : {},
      content: after,
      before: submissionState(now.label, now.status, replaced),
      after,
    });
    return "saved" as const;
  });

  if (saved === "revised") return { error: REVISED };
  if (saved !== "saved") return { error: "Only draft submissions can be edited. Amend it first." };

  const base = inProject(project);
  revalidatePath(`${base}/submissions/${submissionId}`);
  if (shouldClose) revalidatePath(`${base}/submissions`);
  return { savedAt: new Date().toISOString() };
}

// The actions below answer a refusal with its reason, for the form to show beside itself (and keep what was
// typed); they answer nothing when they went through, or go to the page they lead to.

/** A refusal raised inside a transaction, to be answered as the action's state. */
class Refusal extends Error {}

export async function reopenForAmendment(
  project: string,
  submissionId: string,
): Promise<ActionState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const base = inProject(project);

  // Checked and made under the closed submission's lock: a second reopen (a double click, another tab)
  // waits, then finds the amendment the first one made and goes there; an archive waits too.
  const reopen = () => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM controls.submission WHERE id = ${submissionId} FOR UPDATE`;
    const previous = await tx.submission.findUnique({
      where: { id: submissionId },
      include: { answers: true, nextVersion: { select: { id: true } } },
    });
    if (!previous) throw new Refusal("Submission not found.");
    if (previous.status !== "Closed") {
      throw new Refusal("Only final submissions can be amended.");
    }
    if (previous.archivedAt) {
      throw new Refusal("Restore from archive before amending.");
    }
    if (previous.nextVersion) return previous.nextVersion;
    // The amendment is a draft, and a draft follows the template: an answer to a question removed since stays
    // with the closed version only.
    const carried = previous.answers.filter((a) => a.questionId !== null);
    const made = await tx.submission.create({
    data: {
      checklistId: previous.checklistId,
      label: previous.label,
      status: "Draft",
      version: previous.version + 1,
      previousVersionId: previous.id,
      amendReason: null,
      amendRequestedBy: null,
    },
    select: { id: true },
    });
    // An amendment copies each answer as it was, stamp included, and links the same proof files to it.
    await tx.submissionAnswer.createMany({
      data: carried.map((a) => ({
        submissionId: made.id,
        questionId: a.questionId,
        answer: a.answer,
        score: a.score,
        systemVersionPid: a.systemVersionPid,
        systemVersionNumber: a.systemVersionNumber,
        systemCardRevision: a.systemCardRevision,
        answeredAt: a.answeredAt,
      })),
    });
    await carryProofFiles(tx, carried, made.id);
    // The amendment is a new submission (its own item); this event is the closed one's. Its content is the
    // amendment's first state, which the amendment's first save continues as its `before`.
    await emitEvent(tx, {
      action: "controls.submission.reopened",
      itemType: "submission",
      itemId: previous.id,
      details: { next: made.id, version: previous.version + 1, reason: null, requested_by: null },
      content: { next: submissionState(previous.label, "Draft", carried) },
    });
    return made;
  });

  let next: { id: string };
  try {
    try {
      next = await reopen();
    } catch (err) {
      if (!isUniqueClash(err)) throw err;
      next = await reopen();                                     // the other one won: go to its amendment
    }
  } catch (err) {
    if (err instanceof Refusal) return { error: err.message };
    throw err;
  }
  revalidatePath(`${base}/submissions`);
  redirect(`${base}/submissions/${next.id}`);
}

export async function archiveSubmission(project: string, submissionId: string): Promise<ActionState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  // Only a closed one not archived yet, in one statement: two clicks archive it once, with one event.
  const archived = await prisma.$transaction(async (tx) => {
    const done = await tx.submission.updateMany({
      where: { id: submissionId, status: "Closed", archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (done.count > 0) {
      await emitEvent(tx, { action: "controls.submission.archived", itemType: "submission", itemId: submissionId });
    }
    return done.count > 0;
  });
  if (!archived) {
    const sub = await prisma.submission.findUnique({ where: { id: submissionId }, select: { status: true } });
    if (!sub) return { error: "Submission not found." };
    if (sub.status !== "Closed") return { error: "Only final submissions can be archived." };
    return undefined;                                             // archived already
  }
  revalidateSubmissionPages(project, submissionId);
  return undefined;
}

export async function discardDraft(project: string, submissionId: string): Promise<ActionState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  // Under the draft's lock: one closed in another tab meanwhile is refused, not deleted, and the answers that
  // go are the ones read here, which the event keeps as its `before`.
  const notDiscarded = await prisma.$transaction(async (tx) => {
    const [now] = await tx.$queryRaw<{ label: string; status: string; checklistId: string }[]>`
      SELECT label, status::text AS status, "checklistId" FROM controls.submission WHERE id = ${submissionId} FOR UPDATE`;
    if (!now) return "Submission not found.";
    if (now.status !== "Draft") return "Only a draft can be discarded.";
    const answers = await tx.submissionAnswer.findMany({ where: { submissionId } });
    await tx.submission.delete({ where: { id: submissionId } });         // its answers go with it
    await emitEvent(tx, {
      action: "controls.submission.discarded",
      itemType: "submission",
      itemId: submissionId,
      details: { checklist: now.checklistId },
      before: submissionState(now.label, now.status, answers),
    });
    return null;
  });
  if (notDiscarded) return { error: notDiscarded };
  revalidatePath(`${inProject(project)}/submissions`);
  redirect(`${inProject(project)}/submissions`);
}

export async function restoreSubmission(project: string, submissionId: string): Promise<ActionState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const restored = await prisma.$transaction(async (tx) => {
    const done = await tx.submission.updateMany({
      where: { id: submissionId, archivedAt: { not: null } },               // only an archived one comes back
      data: { archivedAt: null },
    });
    if (done.count > 0) {
      await emitEvent(tx, { action: "controls.submission.restored", itemType: "submission", itemId: submissionId });
    }
    return done.count > 0 || (await tx.submission.count({ where: { id: submissionId } })) > 0;
  });
  if (!restored) return { error: "Submission not found." };
  revalidateSubmissionPages(project, submissionId);
  return undefined;
}
