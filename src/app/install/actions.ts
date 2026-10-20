"use server";

import { installFromCatalogue } from "@/app/p/[project]/install/actions";
import { isProjectId } from "@/vendor/aisc-access/projectAccess";

export type ChooseState = { error?: string } | undefined;

/** The project comes from the form, so it is checked here, and the install
 *  action asks the platform whether this person may change it, as every
 *  project action does. */
export async function installChosen(slug: string, prev: ChooseState, formData: FormData): Promise<ChooseState> {
  const project = String(formData.get("project") ?? "");
  if (!isProjectId(project)) return { error: "Choose a project." };
  return installFromCatalogue(project, slug, prev);
}
