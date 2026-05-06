// Cheap "can we ingest right now?" check used by the library page (to gray
// out the upload button) and by the ingest page (to render a fix-it panel
// instead of a form). Errors here are surfaced to the user verbatim, so the
// messages are written for them, not for logs.

export type IngestAvailability =
  | { ok: true }
  | { ok: false; reason: string };

export async function checkIngestAvailability(): Promise<IngestAvailability> {
  const url = process.env.LLM_FACTORY_URL;
  if (!url) {
    return {
      ok: false,
      reason:
        "LLM_FACTORY_URL is not set in .env. Add it (see .env.example) and restart the dev server.",
    };
  }
  if (!process.env.LLM_MODEL) {
    return {
      ok: false,
      reason:
        "LLM_MODEL is not set in .env. Pick one from the supported list in the README.",
    };
  }

  const healthUrl = `${url.replace(/\/+$/, "")}/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    let res: Response;
    try {
      res = await fetch(healthUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: `LLMFactory at ${url} responded ${res.status}. Container is up but unhealthy.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `LLMFactory isn't reachable at ${url}. Start it with \`npm run llm:up\`.`,
    };
  }
}
