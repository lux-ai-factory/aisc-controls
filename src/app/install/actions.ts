"use server";

import { installFromCatalogue } from "@/app/p/[project]/install/actions";
import { isProjectId } from "@/vendor/aisc-access/projectAccess";

export type ChooseState = { error?: string } | undefined;

/** The project comes from the form, so it is checked here: it must be the project of the page's address,
 *  where the gateway bound the request (and so the ledger records the install). The install action then
 *  asks the platform whether this person may change it, as every project action does. */
export async function installChosen(address: string, slug: string, prev: ChooseState, formData: FormData): Promise<ChooseState> {
  const project = String(formData.get("project") ?? "");
  if (!isProjectId(project)) return { error: "Choose a project." };
  if (project !== address) return { error: "Choose the project again: this page installs into its own project. Nothing was installed." };
  return installFromCatalogue(project, slug, prev);
}
