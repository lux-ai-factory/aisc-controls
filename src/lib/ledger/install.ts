import type { InstallRecorder } from "@/lib/installChecklist";

/** `control.installed`'s fields, the same from each of the three install paths. Each path names the action
 *  and calls emitEvent itself, so the platform's ledger coverage test finds the call in its handler. */
export function installedEvent(installed: Parameters<InstallRecorder>[1]) {
  return {
    itemType: "checklist",
    itemId: installed.checklistId,
    details: { package: installed.catalogueId, questions: installed.questions },
    content: installed.content,
  };
}
