"use server";

import { revalidatePath } from "next/cache";
import { installForCaller } from "@/lib/installControl";
import { emitEvent } from "@/lib/ledger/emit";
import { installedEvent } from "@/lib/ledger/install";

export type InstallHereState = { error?: string; installed?: string } | undefined;

/** Install without leaving the catalogue page: the card turns into Installed · Open. */
export async function installHere(project: string, slug: string, _prev: InstallHereState): Promise<InstallHereState> {
  const result = await installForCaller(project, slug,
    (tx, installed) => emitEvent(tx, { action: "control.installed", ...installedEvent(installed) }));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/p/${project}/catalogue`);
  revalidatePath(`/p/${project}/checklists`);
  return { installed: `/p/${encodeURIComponent(project)}/checklists/${result.checklistId}/fill` };
}
