"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  label: z.string().min(1, "Give this submission a name"),
});

export type SubmitState = { error?: string } | undefined;

export async function submitForm(
  questionnaireId: string,
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const parsed = schema.safeParse({ label: formData.get("label") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { id: questionnaireId },
    include: { questions: true },
  });
  if (!questionnaire) return { error: "Questionnaire not found." };

  const validIds = new Set(questionnaire.questions.map((q) => q.id));
  const answers: { questionId: string; answer: string }[] = [];
  for (const [field, raw] of formData.entries()) {
    if (!field.startsWith("a:")) continue;
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    const questionId = field.slice(2);
    if (!validIds.has(questionId)) continue;
    answers.push({ questionId, answer: value });
  }

  const created = await prisma.submission.create({
    data: {
      questionnaireId,
      label: parsed.data.label,
      answers: { create: answers },
    },
    select: { id: true },
  });

  redirect(`/submissions/${created.id}`);
}
