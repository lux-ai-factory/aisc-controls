/**
 * Who is making this request, as a name to show beside what they did (who attached a proof file).
 *
 * Read from the person's token, verified against the realm the way the ledger's gateway check verifies it
 * (src/vendor/aisc-ledger/gatewayToken.ts): their email, else their user name, else their subject. Null
 * when the token is missing or does not verify. With AUTH_ENABLED off (local work, where nothing is
 * verified anywhere) the token's claims are read as they are.
 *
 * Only for display: what the person may do is the platform's answer (projectDbFor), never this.
 */
import { headers } from "next/headers";

import { tokenFromHeaders } from "@/lib/access/callerToken";
import { keyForJwks, verifyToken, type KeyFor } from "@/vendor/aisc-ledger/gatewayToken";

type Claims = Record<string, unknown>;

const keysByUrl = new Map<string, KeyFor>();

const authEnabled = () =>
  ["1", "true", "yes", "on"].includes((process.env.AUTH_ENABLED ?? "true").trim().toLowerCase());

function unverifiedClaims(token: string): Claims | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** The name the claims give: email, user name, display name, subject; null when none is text. */
export function nameFromClaims(claims: Claims | null): string | null {
  if (!claims) return null;
  for (const key of ["email", "preferred_username", "name", "sub"]) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

/** The claims of the person's token, verified unless auth is off; null when there is none that holds. */
export async function claimsOf(token: string | null, deps: { keyFor?: KeyFor } = {}): Promise<Claims | null> {
  if (!token) return null;
  if (!authEnabled()) return unverifiedClaims(token);
  const issuer = process.env.KEYCLOAK_ISSUER ?? "";
  const jwksUrl = process.env.KEYCLOAK_JWKS_URL ?? "";
  if (!issuer || (!jwksUrl && !deps.keyFor)) return null;
  let keyFor = deps.keyFor ?? keysByUrl.get(jwksUrl);
  if (!keyFor) {
    keyFor = keyForJwks(jwksUrl);
    keysByUrl.set(jwksUrl, keyFor);
  }
  return verifyToken(token, { issuer, keyFor });
}

export async function callerName(): Promise<string | null> {
  try {
    return nameFromClaims(await claimsOf(tokenFromHeaders(await headers())));
  } catch {
    return null;
  }
}
