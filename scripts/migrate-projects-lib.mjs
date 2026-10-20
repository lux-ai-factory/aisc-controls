// The parts of migrate-projects.mjs that decide things, apart from the parts
// that touch Postgres, so they can be tested (test/unit/migrateProjects.test.ts).

/** Exit codes, as the controls-migrate service's until-loop reads them. */
export const EXIT = {
  /** Listed every project database; each one was tried. */
  done: 0,
  /** Could not list them (postgres still starting): the loop tries again. */
  retry: 1,
  /** Misconfigured: trying again will not help, so the loop stops. */
  badConfig: 2,
};

const PROJECT_DATABASE = /^project_[0-9a-f]{32}$/;

/** Why this template cannot be used, or null if it can. */
export function templateProblem(template) {
  if (typeof template !== "string" || !template.includes("{database}")) {
    return "PROJECT_DATABASE_URL must contain {database}";
  }
  return null;
}

/** The names that are project databases, in order. */
export function projectDatabases(names) {
  return names.filter((n) => PROJECT_DATABASE.test(n)).sort();
}

/**
 * Migrate each database with `runner(datname, url)`. One that fails is
 * reported and skipped: a broken project must not keep every other project's
 * pages from opening (controls-web waits for this service to succeed), and
 * the web app migrates a project again the first time it is opened.
 */
export async function migrateEach(names, template, runner, log = console) {
  const failed = [];
  let migrated = 0;
  for (const datname of names) {
    log.log(`[controls] migrating ${datname}`);
    try {
      await runner(datname, template.replace("{database}", datname));
      migrated++;
    } catch (err) {
      failed.push(datname);
      log.error(`[controls] could not migrate ${datname}: ${err?.message ?? err}`);
    }
  }
  log.log(
    `[controls] ${migrated} project database(s) up to date` +
      (failed.length ? `, ${failed.length} failed (${failed.join(", ")}); each is migrated again when it is next opened` : ""),
  );
  return { migrated, failed };
}

/** The whole sweep, with the Postgres parts passed in. Returns the exit code. */
export async function sweep({ template, listDatabases, runner, log = console }) {
  const problem = templateProblem(template);
  if (problem) {
    log.error(problem);
    return EXIT.badConfig;
  }
  let names;
  try {
    names = projectDatabases(await listDatabases());
  } catch (err) {
    log.error(`[controls] cannot list the project databases: ${err?.message ?? err}`);
    return EXIT.retry;
  }
  await migrateEach(names, template, runner, log);
  return EXIT.done;
}
