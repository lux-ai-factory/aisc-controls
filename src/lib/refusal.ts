/**
 * A project page the door refused, handed from the middleware to the refused page.
 *
 * The middleware rewrites a refused page to /refused and puts what the platform said in a request header
 * the page reads. A header, not the address: a link cannot set it, so the page never shows words someone
 * put in a link.
 */
export const REFUSAL_HEADER = "x-controls-refusal";

export type Refusal = { status: number; message: string; path: string };

export function refusalHeaderValue(refusal: Refusal): string {
  // a header holds ASCII only; the platform's sentence may not
  return encodeURIComponent(JSON.stringify(refusal));
}

/** The refusal a header carries, or null when there is none or it is not one. */
export function readRefusal(value: string | null): Refusal | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<Refusal>;
    if (typeof parsed.status !== "number" || typeof parsed.message !== "string" || typeof parsed.path !== "string") {
      return null;
    }
    return { status: parsed.status, message: parsed.message, path: parsed.path };
  } catch {
    return null;
  }
}

/** A path this app may offer to open again: one of its own project pages, never another site. */
export function isProjectPagePath(path: string): boolean {
  return /^\/p\/[^/]/.test(path);
}
