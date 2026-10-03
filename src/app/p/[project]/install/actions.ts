"use server";

import { redirect } from "next/navigation";
import { installForCaller } from "@/lib/installControl";
import { emitEvent } from "@/lib/ledger/emit";
import { installedEvent } from "@/lib/ledger/install";

export type InstallState = { error?: string } | undefined;

/** The project is the one bound by the client, so it is checked here, not only
 *  the one in the URL the middleware saw. */
export async function installFromCatalogue(project: string, slug: string, _prev: InstallState): Promise<InstallState> {
  const result = await installForCaller(project, slug,
    (tx, installed) => emitEvent(tx, { action: "control.installed", ...installedEvent(installed) }));
  if (!result.ok) return { error: result.error };
  redirect(result.path);
}
