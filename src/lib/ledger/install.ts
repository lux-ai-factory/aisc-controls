import type { InstallRecorder } from "@/lib/installChecklist";

/** `control.installed`'s fields, the same from each of the three install paths (each names the action and
 *  emits it itself, so the coverage test C4 sees the call in its handler). */
export function installedEvent(installed: Parameters<InstallRecorder>[1]) {
  return {
    itemType: "checklist",
    itemId: installed.checklistId,
    details: { package: installed.catalogueId, questions: installed.questions },
    content: installed.content,
  };
}
