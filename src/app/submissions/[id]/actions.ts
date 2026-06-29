"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseAnswers } from "@/lib/checklistForm";

export type ActionState = { error?: string } | undefined;

async function loadOrFail(submissionId: string) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { checklist: { include: { questions: { select: { id: true } } } } },
  });
  return sub;
}

export async function saveDraft(
  submissionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sub = await loadOrFail(submissionId);
  if (!sub) return { error: "Submission not found." };
  if (sub.status !== "Draft") {
    return { error: "Only draft submissions can be edited. Reopen for amendment first." };
  }

  const validIds = new Set(sub.checklist.questions.map((q) => q.id));
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return { error: "Label cannot be empty." };
  const intent = formData.get("intent");
  const shouldClose = intent === "close";

  const rows = parseAnswers(formData, validIds).map((answer) => ({
    submissionId,
    ...answer,
  }));

  await prisma.$transaction([
    prisma.submission.update({
      where: { id: submissionId },
      data: shouldClose
        ? { label, status: "Closed", closedAt: new Date() }
        : { label },
    }),
    prisma.submissionAnswer.deleteMany({ where: { submissionId } }),
    prisma.submissionAnswer.createMany({ data: rows }),
  ]);

  revalidatePath(`/submissions/${submissionId}`);
  if (shouldClose) revalidatePath("/submissions");
  await auditEvent({ token: formData.get("kc_token")?.toString(),
                     what: shouldClose ? "submission:close" : "submission:save_draft",
                     consequence: { submissionId, label } });
  return undefined;
}

export async function reopenForAmendment(submissionId: string): Promise<void> {
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
  if (previous.nextVersion) {
    redirect(`/submissions/${previous.nextVersion.id}`);
  }

  const next = await prisma.submission.create({
    data: {
      checklistId: previous.checklistId,
      label: previous.label,
      status: "Draft",
      version: previous.version + 1,
      previousVersionId: previous.id,
      answers: {
        create: previous.answers.map((a) => ({
          questionId: a.questionId,
          answer: a.answer,
          score: a.score,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath("/submissions");
  redirect(`/submissions/${next.id}`);
}

export async function archiveSubmission(submissionId: string): Promise<void> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, archivedAt: true },
  });
  if (!sub) throw new Error("Submission not found.");
  if (sub.status !== "Closed") {
    throw new Error("Only closed submissions can be archived.");
  }
  if (sub.archivedAt) return;

  await prisma.submission.update({
    where: { id: submissionId },
    data: { archivedAt: new Date() },
  });
  revalidatePath(`/submissions/${submissionId}`);
  revalidatePath("/submissions");
  revalidatePath("/submissions/archived");
}

export async function restoreSubmission(submissionId: string): Promise<void> {
  await prisma.submission.update({
    where: { id: submissionId },
    data: { archivedAt: null },
  });
  revalidatePath(`/submissions/${submissionId}`);
  revalidatePath("/submissions");
  revalidatePath("/submissions/archived");
}
