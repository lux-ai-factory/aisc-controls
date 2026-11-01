/**
 * The platform's store of proof files, as this app reaches it.
 *
 * The platform keeps the files and decides which ones are taken: their type read from their bytes, the
 * size cap, their SHA-256, and that a stored file is never replaced or deleted. This app only sends a file
 * on and reads one back, with its own token (PLATFORM_CONTROLS_TOKEN) on the platform's internal routes.
 */
import { platformUrl } from "@/lib/appUrls";
import { withoutTrailingSlash } from "@/lib/http";

export type StoredFile = { id: string; name: string; mime: string; size: number; sha256: string };
export type StoreAnswer = { ok: true; file: StoredFile } | { ok: false; status: number; error: string };

const UNAVAILABLE = "The file store cannot be reached just now. Try again in a moment.";
/** The platform's refusals passed on as they are: too large, not a type it takes, no name. */
const PASSED_ON = new Set([413, 415, 422]);
/** Sending a 25 MB file over the backend network takes well under this. */
const TIMEOUT_MS = 60_000;

function base(pid: string): string | null {
  const url = withoutTrailingSlash(platformUrl());
  return url ? `${url}/internal/projects/${encodeURIComponent(pid)}/proof-files` : null;
}

function token(): Record<string, string> {
  const value = process.env.PLATFORM_CONTROLS_TOKEN ?? "";
  return value ? { "X-AISC-Service-Token": value } : {};
}

function isStoredFile(v: unknown): v is StoredFile {
  const f = v as StoredFile | null;
  return !!f && typeof f.id === "string" && typeof f.name === "string" && typeof f.mime === "string"
    && typeof f.size === "number" && typeof f.sha256 === "string";
}

/** Send one file to the platform; what it stored, or why not. */
export async function storeProofFile(
  pid: string,
  name: string,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<StoreAnswer> {
  const url = base(pid);
  if (!url) return { ok: false, status: 503, error: UNAVAILABLE };
  try {
    const res = await fetchImpl(`${url}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", ...token() },
      body: bytes as unknown as BodyInit,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    if (res.status === 201 && isStoredFile(body)) {
      const { id, name: kept, mime, size, sha256 } = body;
      return { ok: true, file: { id, name: kept, mime, size, sha256 } };
    }
    if (PASSED_ON.has(res.status) && typeof body?.detail === "string") {
      return { ok: false, status: res.status, error: body.detail };
    }
    console.warn(`controls: the platform did not store a proof file (${res.status})`);
    return { ok: false, status: 503, error: UNAVAILABLE };
  } catch (err) {
    console.warn(`controls: the platform could not be reached to store a proof file (${(err as Error)?.name})`);
    return { ok: false, status: 503, error: UNAVAILABLE };
  }
}

/** The platform's answer with a stored file's bytes, null when it has no such file; throws when it cannot be asked. */
export async function readProofFile(pid: string, fileId: string, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  const url = base(pid);
  if (!url) throw new Error("PLATFORM_URL is not set");
  const res = await fetchImpl(`${url}/${encodeURIComponent(fileId)}`, {
    headers: token(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`the platform answered ${res.status}`);
  return res;
}
