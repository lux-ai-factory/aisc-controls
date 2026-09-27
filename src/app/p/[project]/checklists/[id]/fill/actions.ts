"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writableProject } from "@/lib/projectDb";
import { parseAnswers } from "@/lib/checklistForm";

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
  const answers = parseAnswers(formData, validIds);

  const created = await prisma.submission.create({
    data: {
      checklistId,
      label: parsed.data.label,
      answers: { create: answers },
    },
    select: { id: true },
  });

  redirect(`/p/${project}/submissions/${created.id}`);
}
