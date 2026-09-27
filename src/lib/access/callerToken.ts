/**
 * The person behind the request, as a token this app can pass on.
 *
 * Every page here is served behind the gateway, which holds the session and
 * copies the access token it has onto the request. This app calls the platform
 * on behalf of whoever is using it, not as itself: there is no service account,
 * and a project belongs to the people in it.
 */
import { headers } from "next/headers";

/** What oauth2-proxy calls the token it holds, copied through by Caddy. */
export const GATEWAY_TOKEN_HEADER = "x-auth-request-access-token";

/** The token on these headers: a bearer token if one is sent, else the gateway's. */
export function tokenFromHeaders(incoming: Pick<Headers, "get">): string | null {
  const authorization = incoming.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim() || null;
  }
  return incoming.get(GATEWAY_TOKEN_HEADER);
}

export async function callerToken(): Promise<string | null> {
  try {
    return tokenFromHeaders(await headers());
  } catch {
    return null;
  }
}
