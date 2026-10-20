/**
 * Whether the template editor (a checklist's "Edit questions", the review page and its action) is on:
 * only when AISC_ENABLE_TEMPLATE_EDITOR is "true". Off, the list hides the link, the page is not found
 * and the action refuses. The one place the flag is read.
 */
export function templateEditorEnabled(): boolean {
  return process.env.AISC_ENABLE_TEMPLATE_EDITOR === "true";
}

/** What the editor's save returns when the flag is off: the { error } of any refused write, its own words. */
export const TEMPLATE_EDITOR_OFF = "The question editor is turned off on this installation.";

/**
 * Who may use the editor when it is on: administrators only. A removed question takes its answers with it,
 * closed submissions' too, so a project editor does not get it. A refusal, the platform's silence included,
 * is no.
 */
export function mayEditTemplate(access: { ok: boolean; admin?: boolean }): boolean {
  return access.ok && access.admin === true;
}

/** What the editor's save returns to somebody who is not an administrator. */
export const TEMPLATE_EDITOR_ADMINS_ONLY = "Only an administrator can edit a checklist's questions.";
