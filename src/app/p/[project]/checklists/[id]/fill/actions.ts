"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writableProject } from "@/lib/projectDb";
import { parseAnswers, REVISED } from "@/lib/checklistForm";
import { emitEvent } from "@/lib/ledger/emit";
import { submissionState } from "@/lib/ledger/state";
import { latestVersion } from "@/lib/systemVersion";
import { callerToken } from "@/lib/access/callerToken";

const schema = z.object({
  label: z.string().min(1, "Give this submission a name"),
});

export type SubmitState = { error?: string } | undefined;

export async function submitForm(
  project: string,
  checklistId: string,
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const parsed = schema.safeParse({ label: formData.get("label") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    include: { questions: true },
  });
  if (!checklist) return { error: "Checklist not found." };

  const validIds = new Set(checklist.questions.map((q) => q.id));
  // Each answer carries the card version that was the latest when it was answered, as saveDraft
  // stamps a new or changed one; with the platform not answering it is saved unstamped.
  const given = parseAnswers(formData, validIds);
  const latest = given.length ? await latestVersion(project, await callerToken()) : null;
  const answeredAt = new Date();
  const answers = given.map((answer) => ({
    ...answer,
    systemVersionPid: latest?.pid ?? null,
    systemVersionNumber: latest?.number ?? null,
    answeredAt,
  }));

  // The submission and its ledger event, in one transaction. A review of the checklist locks it to
  // replace its questions: this waits for it, and refuses answers to questions it removed rather than
  // failing on the foreign key.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR SHARE`;
    const current = new Set((await tx.question.findMany({ where: { checklistId }, select: { id: true } }))
      .map((q) => q.id));
    if (answers.some((a) => !current.has(a.questionId))) return null;
    const made = await tx.submission.create({
      data: {
        checklistId,
        label: parsed.data.label,
        answers: { create: answers },
      },
      select: { id: true },
    });
    const state = submissionState(parsed.data.label, "Draft", answers);
    await emitEvent(tx, {
      action: "controls.submission.created",
      itemType: "submission",
      itemId: made.id,
      details: { checklist: checklistId },
      content: state,
      after: state,
    });
    return made;
  });
  if (!created) return { error: REVISED };

  redirect(`/p/${project}/submissions/${created.id}`);
}
