// The standalone .env's own secrets, made by scripts/setup-once.mjs. Kept apart
// from that script so they can be tested without running it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const WEB_TO_PDF_TOKEN = "CONTROLS_WEB_TO_PDF_TOKEN";
// The variable's line, set or empty; a commented line is not it.
const TOKEN_LINE = new RegExp(`^\\s*${WEB_TO_PDF_TOKEN}\\s*=\\s*(.*?)\\s*$`, "m");

/** A token for the PDF renderer: 32 random bytes, hex. */
export function randomToken() {
  return randomBytes(32).toString("hex");
}

/**
 * The .env text with a CONTROLS_WEB_TO_PDF_TOKEN in it: a set one is kept, an
 * empty one is filled in place, a missing one is added at the end.
 * `written` says whether the text changed.
 */
export function withWebToPdfToken(text, makeToken = randomToken) {
  const found = text.match(TOKEN_LINE);
  const value = found ? found[1].replace(/^(["'])(.*)\1$/, "$2") : "";
  if (value) return { text, written: false };
  const line = `${WEB_TO_PDF_TOKEN}="${makeToken()}"`;
  if (found) return { text: text.replace(TOKEN_LINE, line), written: true };
  const ending = text === "" || text.endsWith("\n") ? "" : "\n";
  return { text: `${text}${ending}${line}\n`, written: true };
}

/**
 * Write a random CONTROLS_WEB_TO_PDF_TOKEN into `envFile` when it has none, so
 * the app and the bundled PDF renderer (which docker compose gives the value
 * from the same .env) share it. False when there is no file or it has one.
 */
export function ensureWebToPdfToken(envFile, makeToken = randomToken) {
  if (!existsSync(envFile)) return false;
  const { text, written } = withWebToPdfToken(readFileSync(envFile, "utf8"), makeToken);
  if (written) writeFileSync(envFile, text);
  return written;
}
