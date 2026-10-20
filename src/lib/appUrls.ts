// Where this app and its neighbours are, from the environment. Read at call
// time, on the server, so a running container picks up its own settings.

/**
 * The path prefix the app is served under (e.g. /controls behind Caddy), or ""
 * at the root: the same NEXT_BASE_PATH next.config reads. Next applies it to
 * <Link> and its own assets, but not to raw <a href> links or files in public/,
 * which have to add it themselves.
 */
export function appBasePath(): string {
  return process.env.NEXT_BASE_PATH || "";
}

/** The launcher, where a project is chosen. */
export function launcherUrl(): string {
  return process.env.LAUNCHER_URL || "http://localhost:8100/";
}

/** The platform API, which says who is in which project; "" when unset. */
export function platformUrl(): string {
  return process.env.PLATFORM_URL ?? "";
}
