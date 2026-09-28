"use server";

import { revalidatePath } from "next/cache";
import { installForCaller } from "@/lib/installControl";

export type InstallHereState = { error?: string; installed?: string } | undefined;

/** Install without leaving the catalogue page: the card turns into Installed · Open. */
export async function installHere(project: string, slug: string, _prev: InstallHereState): Promise<InstallHereState> {
  const result = await installForCaller(project, slug);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/p/${project}/catalogue`);
  revalidatePath(`/p/${project}/checklists`);
  return { installed: `/p/${encodeURIComponent(project)}/checklists/${result.checklistId}/fill` };
}
