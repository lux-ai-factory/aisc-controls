// The parts of migrate-projects.mjs that decide things, apart from the parts
// that touch Postgres, so they can be tested (test/unit/migrateProjects.test.ts).

/** Exit codes, as the controls-migrate service's until-loop reads them. */
export const EXIT = {
  /** Listed every project database; each one was tried. */
  done: 0,
  /** Could not list them (postgres still starting), or a schema is not its owner's yet: the loop tries again. */
  retry: 1,
  /** Misconfigured, or a database named on the command line failed: trying again will not help. */
  badConfig: 2,
};

const PROJECT_DATABASE = /^project_[0-9a-f]{32}$/;

/** Why this template cannot be used, or null if it can. */
export function templateProblem(template) {
  if (typeof template !== "string" || !template.includes("{database}")) {
    return "PROJECT_MIGRATE_DATABASE_URL must contain {database}: migrations run as controls_migrator";
  }
  return null;
}

/** The role that owns the controls schema and its tables; controls_migrator acts as it. */
export const OWNER = "controls_owner";

/** Who owns the controls schema of the database a client is on (one row, `owner`, or none). */
export const SCHEMA_OWNER_QUERY =
  "SELECT pg_get_userbyid(nspowner)::text AS owner FROM pg_namespace WHERE nspname = 'controls'";

/** Who may hold the schema before it is handed to its owner: the platform, which makes it. */
const NOT_HANDED_OVER_YET = new Set([null, "platform_rw", "platform_owner"]);

/**
 * Why a project database may not be migrated, or null. Its controls schema must belong to
 * controls_owner: the platform hands it over once postgres-setup has made the role. `wait` says the
 * hand-over is still to come (the schema is missing or still the platform's), so the sweep tries
 * again; a schema of anyone else is that database's failure.
 */
export function ownerProblem(owner) {
  if (owner === OWNER) return null;
  return {
    wait: NOT_HANDED_OVER_YET.has(owner ?? null),
    text: `schema controls belongs to ${owner ?? "nobody (it is missing)"}, not ${OWNER}: run postgres-setup (init/owner-roles.sql) and start the platform, which hands it over`,
  };
}

/** The parameters only Prisma reads: pg would pass them to the server, which refuses them. */
const PRISMA_ONLY = ["schema", "connection_limit", "pool_timeout"];

/**
 * A database URL as pg.Client takes it: without Prisma's own parameters, with every other
 * connection option (sslmode and the like) kept. src/lib/projectDb.ts does the same.
 */
export function pgConnectionString(url) {
  const [base, query = ""] = url.split(/\?(.*)/s);
  const params = new URLSearchParams(query);
  for (const name of PRISMA_ONLY) params.delete(name);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

/** The names that are project databases, in order. */
export function projectDatabases(names) {
  return names.filter((n) => PROJECT_DATABASE.test(n)).sort();
}

/**
 * Migrate each database with `runner(datname, url)`. One that fails is
 * reported and skipped: a broken project must not keep every other project's
 * pages from opening (controls-web waits for this service to succeed), and
 * the web app migrates a project again the first time it is opened. One whose
 * runner throws an error marked `wait` (its schema is not its owner's yet) is
 * reported as waiting.
 */
export async function migrateEach(names, template, runner, log = console) {
  const failed = [];
  const waiting = [];
  let migrated = 0;
  for (const datname of names) {
    log.log(`[controls] migrating ${datname}`);
    try {
      await runner(datname, template.replace("{database}", datname));
      migrated++;
    } catch (err) {
      if (err?.wait) {
        waiting.push(datname);
        log.error(`[controls] ${datname} waits: ${err?.message ?? err}`);
        continue;
      }
      failed.push(datname);
      log.error(`[controls] could not migrate ${datname}: ${err?.message ?? err}`);
    }
  }
  log.log(
    `[controls] ${migrated} project database(s) up to date` +
      (failed.length ? `, ${failed.length} failed (${failed.join(", ")}); each is migrated again when it is next opened` : ""),
  );
  return { migrated, failed, waiting };
}

/**
 * The whole sweep, with the Postgres parts passed in. Returns the exit code. With `names`, only those
 * databases (each a project database), and any failure is the exit's: the web app runs this for the one
 * project it opens and must know.
 */
export async function sweep({ template, listDatabases, runner, names = null, log = console }) {
  const problem = templateProblem(template);
  if (problem) {
    log.error(problem);
    return EXIT.badConfig;
  }
  const named = Array.isArray(names) && names.length > 0;
  if (named && projectDatabases(names).length !== names.length) {
    log.error("[controls] only project_<32 hex> databases may be named");
    return EXIT.badConfig;
  }
  let databases;
  try {
    databases = named ? names : projectDatabases(await listDatabases());
  } catch (err) {
    log.error(`[controls] cannot list the project databases: ${err?.message ?? err}`);
    return EXIT.retry;
  }
  const { failed, waiting } = await migrateEach(databases, template, runner, log);
  if (named && failed.length) return EXIT.badConfig;
  if (waiting.length) {
    log.error(
      `[controls] ${waiting.length} project database(s) wait for their schema to belong to ${OWNER}: run postgres-setup, then let the platform start`,
    );
    return EXIT.retry;
  }
  return EXIT.done;
}
