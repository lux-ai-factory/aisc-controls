import { redirect } from "next/navigation";
import { launcherUrl } from "@/lib/appUrls";

/**
 * The app reached without a project.
 *
 * The project is chosen once, on the launcher. An answered checklist is about
 * one project's AI system, so rather than offering a second project list this
 * page sends you where that choice is made; the launcher's card opens this app
 * on the project you pick.
 */
export default function NoProjectPage() {
  redirect(launcherUrl());
}
