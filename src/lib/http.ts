/** The URL without trailing slashes, so a path can be appended to it. */
export function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The Authorization header that passes a token on, or none without one. */
export function bearer(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
