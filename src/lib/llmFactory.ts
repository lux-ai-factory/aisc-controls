// Thin connector to the bundled LLMFactory HTTP service (services/llm_factory/).
// Provider routing and credentials live inside that service, so this client
// stays provider-agnostic.

export type LLMFactoryOptions = {
  url?: string;
  timeoutMs?: number;
};

export async function executePrompt(
  llm: string,
  prompt: string,
  opts: LLMFactoryOptions = {},
): Promise<string> {
  const url = opts.url ?? process.env.LLM_FACTORY_URL;
  if (!url) {
    throw new Error(
      "LLM_FACTORY_URL is not configured on the server — add it to .env.",
    );
  }

  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/execute_prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: llm, prompt }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `LLMFactory at ${url} did not respond within ${Math.round(timeout / 1000)}s. Try a smaller document or check provider latency.`,
      );
    }
    throw new Error(
      `Couldn't reach LLMFactory at ${url}. Is it running? Try \`npm run llm:up\`.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractDetail(body);
    if (looksLikeAuthError(res.status, detail)) {
      throw new Error(
        `The provider rejected the request — likely a missing or invalid API key. Check the API_KEY_* env var matching the model "${llm}", then \`npm run llm:down && npm run llm:up\` to pick up the change. Provider said: ${detail.slice(0, 240)}`,
      );
    }
    if (looksLikeUnknownModel(detail)) {
      throw new Error(
        `LLMFactory does not have a builder registered for model "${llm}". Check LLM_MODEL in .env or register it in services/llm_factory/llm_services/llm_factory.py.`,
      );
    }
    throw new Error(
      `LLMFactory request failed (${res.status} ${res.statusText}): ${detail.slice(0, 300)}`,
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json()) as { response?: unknown; error?: unknown };
    if (typeof data.error === "string") {
      throw new Error(`LLMFactory returned an error: ${data.error}`);
    }
    if (typeof data.response !== "string") {
      throw new Error(
        `LLMFactory returned JSON without a string "response" field: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return data.response;
  }
  return (await res.text()).trim();
}

// LLMFactory bubbles upstream errors as Flask 500 HTML stack traces (or, with
// the bundled api.py patch, as JSON {error}). Pull whichever signal is there.
function extractDetail(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "(empty response body)";
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    /* not JSON — fall through */
  }
  // Best-effort strip of the surrounding HTML when Flask debug page came back.
  return trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeAuthError(status: number, detail: string): boolean {
  if (status === 401 || status === 403) return true;
  return /\b(authentication|api[\s_-]?key|unauthorized|invalid[\s_-]?key|x-api-key)\b/i.test(
    detail,
  );
}

function looksLikeUnknownModel(detail: string): boolean {
  return /ValueError|register_builder|unknown model|not registered/i.test(detail);
}
