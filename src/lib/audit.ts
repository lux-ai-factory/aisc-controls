/**
 * Server-side audit forwarding for controls.
 *
 * Per the immudb design: only the SERVER logs, the SERVER decides `what`/`consequence` (the user can't
 * forge them), and the user's Keycloak token is forwarded so the backend stamps the verified "who".
 * This posts to the aisc-backend /audit endpoint (the single immudb writer). Best-effort: a logging
 * failure must NEVER break the user's action.
 */
const BACKEND_URL = process.env.AISC_BACKEND_URL || "http://localhost:8000";

export async function auditEvent(opts: {
  token?: string | null;
  what: string;
  consequence?: Record<string, unknown>;
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
        what: opts.what, // server-decided, NOT user-supplied
        app: "controls",
        consequence: opts.consequence ?? {},
      }),
    });
  } catch (e) {
    // swallow — the audit log must not break the action
    console.warn("controls audit forward failed:", e);
  }
}
