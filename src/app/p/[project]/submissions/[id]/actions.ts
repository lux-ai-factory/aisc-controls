"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { projectDbFor, writableProject } from "@/lib/projectDb";
import type { PrismaClient, SubmissionAnswer } from "@prisma/client";
import { parseAnswers, type ParsedAnswer } from "@/lib/checklistForm";
import { latestVersion } from "@/lib/systemVersion";
import { callerToken } from "@/lib/access/callerToken";
import { emitEvent } from "@/lib/ledger/emit";
import { submissionState } from "@/lib/ledger/state";

export type ActionState = { error?: string } | undefined;

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
    return { error: "Only draft submissions can be edited. Reopen for amendment first." };
  }

  const validIds = new Set(sub.checklist.questions.map((q) => q.id));
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return { error: "Label cannot be empty." };
  const shouldClose = formData.get("intent") === "close";

  // Each answer carries the card version that was the latest when it was
  // answered. The rows are deleted and recreated, so an unchanged answer keeps
  // its old stamp; only a new or changed one is stamped now. The platform is
  // asked once, and only when there is something to stamp.
  const parsed = parseAnswers(formData, validIds);
  const old = new Map(
    (await prisma.submissionAnswer.findMany({ where: { submissionId } })).map((a) => [a.questionId, a]),
  );
  const now = new Date();
  const latest = parsed.every((a) => isUnchanged(a, old.get(a.questionId)))
    ? null
    : await latestVersion(project, await callerToken());
  const rows = parsed.map((answer) => {
    const before = old.get(answer.questionId);
    const stamp = isUnchanged(answer, before)
      ? {
          systemVersionPid: before.systemVersionPid,
          systemVersionNumber: before.systemVersionNumber,
          answeredAt: before.answeredAt,
        }
      : {
          systemVersionPid: latest?.pid ?? null,
          systemVersionNumber: latest?.number ?? null,
          answeredAt: now,
        };
    return { submissionId, ...answer, ...stamp };
  });

  // The draft, its answers and its event, in one transaction (ledger phase 7). The draft is locked and read
  // again inside it (review m1): one closed in another tab since the reads above is refused, not rewritten,
  // and the answers it replaces, read under the lock, are its event's `before`.
  const after = submissionState(label, shouldClose ? "Closed" : "Draft", rows);
  const saved = await prisma.$transaction(async (tx) => {
    const [now] = await tx.$queryRaw<{ label: string; status: string }[]>`
      SELECT label, status::text AS status FROM controls.submission WHERE id = ${submissionId} FOR UPDATE`;
    if (!now || now.status !== "Draft") return false;
    const replaced = await tx.submissionAnswer.findMany({ where: { submissionId } });
    await tx.submission.update({
      where: { id: submissionId },
      data: shouldClose
        ? { label, status: "Closed", closedAt: new Date() }
        : { label },
    });
    await tx.submissionAnswer.deleteMany({ where: { submissionId } });
    await tx.submissionAnswer.createMany({ data: rows });
    await emitEvent(tx, {
      action: shouldClose ? "controls.submission.closed" : "controls.submission.draft_saved",
      itemType: "submission",
      itemId: submissionId,
      details: shouldClose ? { score: rows.reduce((n, r) => n + (r.score ?? 0), 0) } : {},
      content: after,
      before: submissionState(now.label, now.status, replaced),
      after,
    });
    return true;
  });
  if (!saved) return { error: "Only draft submissions can be edited. Reopen for amendment first." };

  const base = inProject(project);
  revalidatePath(`${base}/submissions/${submissionId}`);
  if (shouldClose) revalidatePath(`${base}/submissions`);
  return undefined;
}

// The actions below throw when refused: they return nothing, so there is no
// state to put the refusal in, and the page shows it as an error.

export async function reopenForAmendment(project: string, submissionId: string): Promise<void> {
  const prisma = await projectDbFor(project, { write: true });
  const previous = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { answers: true, nextVersion: { select: { id: true } } },
  });
  if (!previous) throw new Error("Submission not found.");
  if (previous.status !== "Closed") {
    throw new Error("Only closed submissions can be amended.");
  }
  if (previous.archivedAt) {
    throw new Error("Restore from archive before amending.");
  }
  const base = inProject(project);
  if (previous.nextVersion) {
    redirect(`${base}/submissions/${previous.nextVersion.id}`);
  }

  const next = await prisma.$transaction(async (tx) => {
    const made = await tx.submission.create({
    data: {
      checklistId: previous.checklistId,
      label: previous.label,
      status: "Draft",
      version: previous.version + 1,
      previousVersionId: previous.id,
      answers: {
        // An amendment copies each answer as it was, stamp included.
        create: previous.answers.map((a) => ({
          questionId: a.questionId,
          answer: a.answer,
          score: a.score,
          systemVersionPid: a.systemVersionPid,
          systemVersionNumber: a.systemVersionNumber,
          answeredAt: a.answeredAt,
        })),
      },
    },
    select: { id: true },
    });
    // The amendment is a new submission (its own item); this event is the closed one's. Its content is the
    // amendment's first state, which the amendment's first save continues as its `before` (review m6).
    await emitEvent(tx, {
      action: "controls.submission.reopened",
      itemType: "submission",
      itemId: previous.id,
      details: { next: made.id, version: previous.version + 1 },
      content: { next: submissionState(previous.label, "Draft", previous.answers) },
    });
    return made;
  });

  revalidatePath(`${base}/submissions`);
  redirect(`${base}/submissions/${next.id}`);
}

export async function archiveSubmission(project: string, submissionId: string): Promise<void> {
  const prisma = await projectDbFor(project, { write: true });
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, archivedAt: true },
  });
  if (!sub) throw new Error("Submission not found.");
  if (sub.status !== "Closed") {
    throw new Error("Only closed submissions can be archived.");
  }
  if (sub.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({ where: { id: submissionId }, data: { archivedAt: new Date() } });
    await emitEvent(tx, { action: "controls.submission.archived", itemType: "submission", itemId: submissionId });
  });
  revalidateSubmissionPages(project, submissionId);
}

export async function restoreSubmission(project: string, submissionId: string): Promise<void> {
  const prisma = await projectDbFor(project, { write: true });
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
  if (!restored) throw new Error("Submission not found.");
  revalidateSubmissionPages(project, submissionId);
}
