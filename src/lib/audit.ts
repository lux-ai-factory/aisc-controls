/**
 * Server-side audit forwarding for controls.
 *
 * Per the immudb design: only the SERVER logs, the SERVER decides `action`/`resource_type` (the user can't
 * forge them), and the user's Keycloak token is forwarded so the backend stamps the verified `actor` and
 * the `source_ip`. This posts to the aisc-backend /audit endpoint (the single immudb writer). Best-effort:
 * a logging failure must NEVER break the user's action.
 */
const BACKEND_URL = process.env.AISC_BACKEND_URL || "http://localhost:8000";

export async function auditEvent(opts: {
  token?: string | null;
  action: string; // the verb: answer | review | create | save_draft | close | ...
  resource_type: string; // the object type: checklist | source | submission | ...
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
  outcome?: string;
}): Promise<void> {
  if (!opts.token) return; // not logged in / no token -> skip silently (never break the action)
  try {
    await fetch(`${BACKEND_URL}/api/v1/audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        // action + resource_type are server-decided, NOT user-supplied
        action: opts.action,
        resource_type: opts.resource_type,
        resource_id: opts.resource_id ?? null,
        source_app: "controls",
        metadata: opts.metadata ?? {},
        outcome: opts.outcome ?? "ok",
      }),
    });
  } catch (e) {
    // swallow — the audit log must not break the action
    console.warn("controls audit forward failed:", e);
  }
}
