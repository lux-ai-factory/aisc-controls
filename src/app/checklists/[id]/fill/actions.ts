"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseAnswers } from "@/lib/checklistForm";
import { auditEvent } from "@/lib/audit";

const schema = z.object({
  label: z.string().min(1, "Give this submission a name"),
});

export type SubmitState = { error?: string } | undefined;

export async function submitForm(
  checklistId: string,
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const parsed = schema.safeParse({ label: formData.get("label") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    include: { questions: true },
  });
  if (!checklist) return { error: "Checklist not found." };

  const validIds = new Set(checklist.questions.map((q) => q.id));
  const answers = parseAnswers(formData, validIds);

  const created = await prisma.submission.create({
    data: {
      checklistId,
      label: parsed.data.label,
      answers: { create: answers },
    },
    select: { id: true },
  });

  // AUDIT (server-side, before redirect): who answered which checklist + the result.
  // `what` is set HERE by the server (not the client); the user's token (forwarded via a hidden field)
  // gives the verified "who". Best-effort — auditEvent never throws.
  await auditEvent({
    token: formData.get("kc_token")?.toString(),
    action: "answer",
    resource_type: "checklist",
    resource_id: checklistId,
    metadata: {
      submissionId: created.id,
      label: parsed.data.label,
      answerCount: answers.length,
    },
  });

  redirect(`/submissions/${created.id}`);
}
