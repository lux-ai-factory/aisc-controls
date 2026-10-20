/**
 * The database of one project.
 *
 * Every project has a database of its own, made by the platform when the
 * project is made. This app keeps a project's checklists and submissions there
 * and nowhere else, so a query that forgets to filter still cannot reach
 * another project.
 *
 * Pages and actions open it through projectDbFor, which asks the platform
 * whether the caller is in *that* project, the one it was told to open. The
 * middleware checks the project in the URL; a server action's arguments come
 * from the client, and can name a different one.
 */
import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { notFound } from "next/navigation";
import pg from "pg";

import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { admit, isProjectId, type Admission } from "@/vendor/aisc-access/projectAccess";

const run = promisify(execFile);

export class NotAProject extends Error {}

/** The caller may not do this here; the message is fit to show them. */
class Refused extends Error {}

export function projectDatabaseName(pid: string): string {
  if (!isProjectId(pid)) throw new NotAProject(`not a project id: ${JSON.stringify(pid)}`);
  return `project_${pid.toLowerCase().replace(/-/g, "")}`;
}

/**
 * A 404 for anything that is not a pid. The middleware lets through any slug
 * the platform recognises, but only a pid names a database, so a slug that is
 * not one is "not found", not a crash.
 */
export function notFoundUnlessProject(pid: string): void {
  try {
    projectDatabaseName(pid);
  } catch (err) {
    if (err instanceof NotAProject) notFound();
    throw err;
  }
}

export function projectDatabaseUrl(
  pid: string,
  template: string = process.env.PROJECT_DATABASE_URL ?? "",
): string {
  if (!template.includes("{database}")) {
    throw new Error("PROJECT_DATABASE_URL must contain {database}");
  }
  return template.replace("{database}", projectDatabaseName(pid));
}

/** Bring one project database to this app's schema. */
async function migrateProjectDatabase(url: string): Promise<void> {
  await run("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
  });
}

/**
 * How many project databases this process keeps a client open to.
 *
 * Each client holds up to connection_limit=2 connections, so this is the
 * connection budget: 2 × 20 = 40 at most. The least recently used idle client is
 * disconnected when a 21st project is opened, and reconnects if it is needed
 * again, without migrating again: this process remembers which databases it
 * migrated. A client with work in progress (its migration, a query, a transaction)
 * is never disconnected: while every one is busy there may be more than 20 for a
 * moment, and the oldest is let go when its work ends.
 */
export const MAX_OPEN_PROJECTS = 20;

/** `busy`: the work in progress on the client (its migration, queries, transactions). */
type Entry = { client: PrismaClient; ready: Promise<void>; busy: number };
const store = globalThis as unknown as { projectDatabases?: Map<string, Entry> };
const open = (store.projectDatabases ??= new Map<string, Entry>());
/** The databases this process migrated: an evicted one reopened is not migrated again. A failed
 *  migration, or a database found missing, is not kept, so the next open migrates. */
const migrated = ((store as { migratedProjects?: Set<string> }).migratedProjects ??= new Set<string>());

function forget(url: string, entry: Entry) {
  if (open.get(url) === entry) open.delete(url);
  entry.client.$disconnect().catch(() => {});
}

/** Over the budget, let go of the least recently used idle clients. A busy one stays, and so does
 *  the most recently used: it is the one just handed to a request, even if every other is busy. */
function evictIdle() {
  const newest = [...open.keys()].pop();
  for (const [url, entry] of open) {
    if (open.size <= MAX_OPEN_PROJECTS) return;
    if (entry.busy === 0 && url !== newest) forget(url, entry);
  }
}

const MISSING = /database .* does not exist/i;

/**
 * Postgres says the database is not there: the project was deleted, most likely.
 * A failed `prisma migrate deploy` (run through execFile) says so in its output.
 */
export function isMissingDatabase(err: unknown): boolean {
  const e = err as { code?: unknown; errorCode?: unknown; message?: unknown; stderr?: unknown; stdout?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (e.code === "P1003" || e.errorCode === "P1003") return true;
  if (typeof e.message === "string" && MISSING.test(e.message)) return true;
  return [e.stderr, e.stdout].some((out) => out != null && (/\bP1003\b/.test(String(out)) || MISSING.test(String(out))));
}

/** The connection went away under the client: the database may have been dropped. */
function isLostConnection(err: unknown): boolean {
  const e = err as { code?: unknown; errorCode?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  if (["P1001", "P1017"].includes(e.code as string) || ["P1001", "P1017"].includes(e.errorCode as string)) return true;
  return typeof e.message === "string" && /terminating connection|server has closed the connection/i.test(e.message);
}

/**
 * Whether this project's database is still there, asked of the cluster (the `postgres`
 * database, as scripts/migrate-projects.mjs does). Null when the cluster does not answer,
 * so the caller keeps the error it had.
 */
async function databaseExists(pid: string): Promise<boolean | null> {
  const catalog = new pg.Client({
    connectionString: (process.env.PROJECT_DATABASE_URL ?? "").replace("{database}", "postgres").split("?")[0],
  });
  try {
    await catalog.connect();
    const { rowCount } = await catalog.query("SELECT 1 FROM pg_database WHERE datname = $1", [projectDatabaseName(pid)]);
    return (rowCount ?? 0) > 0;
  } catch {
    return null;
  } finally {
    await catalog.end().catch(() => {});
  }
}

/** The schema a database URL names (`?schema=`, as Prisma reads it), Prisma's `public` otherwise. */
function schemaOf(url: string): string {
  try {
    return new URL(url).searchParams.get("schema") || "public";
  } catch {
    return "public";
  }
}

/**
 * The id of the checklist installed from this catalogue entry in that project database, asked
 * read-only: nothing is migrated or created. Null when there is none, when the database is not
 * there, or when it was never migrated (no checklist table yet). The install dialog lists every
 * project the person may write, and opening one through prismaFor migrates it: only an install
 * migrates the project it goes into.
 */
export async function lookupInstalledChecklist(url: string, catalogueId: string): Promise<string | null> {
  const schema = `"${schemaOf(url).replace(/"/g, '""')}"`;
  const client = new pg.Client({ connectionString: url.split("?")[0] });
  try {
    await client.connect();
    const { rows } = await client.query(`SELECT id FROM ${schema}.checklist WHERE "catalogueId" = $1`, [catalogueId]);
    return (rows[0]?.id as string | undefined) ?? null;
  } catch (err) {
    // not there, not migrated, or not answering: not known to have it; the install checks
    // again and says why if it cannot write either. Anything but a missing database, schema or
    // table is logged (by its code, never the URL, which holds the password).
    const code = (err as { code?: unknown } | null)?.code;
    if (!LOOKUP_EXPECTED.has(String(code))) {
      console.warn(`controls: could not tell whether a control is installed in a project database (${String(code ?? (err as Error)?.name)})`);
    }
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Postgres' codes for a database, schema or table that is not there: a project not created or not migrated. */
const LOOKUP_EXPECTED = new Set(["3D000", "3F000", "42P01"]);

/** A dropped (or never made) project database is "not found" for that pid, never a 500. */
async function notFoundIfGone(pid: string, err: unknown): Promise<void> {
  if (isMissingDatabase(err) || (await databaseExists(pid)) === false) notFound();
}

/**
 * The client for this project's database, migrated before its first use.
 * Requests that arrive together share one migration; one that failed is
 * forgotten, so the next request tries again.
 *
 * This does not check who is asking. Pages and actions use projectDbFor.
 */
export async function prismaFor(
  pid: string,
  deps: { migrate: (url: string) => Promise<void>; newClient?: (url: string) => PrismaClient } = {
    migrate: migrateProjectDatabase,
  },
): Promise<PrismaClient> {
  const url = projectDatabaseUrl(pid);
  let entry = open.get(url);
  if (entry) {
    // Most recently used goes last; the first in the map is the one to evict.
    open.delete(url);
    open.set(url, entry);
  } else {
    const ready = migrated.has(url) ? Promise.resolve() : deps.migrate(url).then(() => { migrated.add(url); });
    const client = deps.newClient ? deps.newClient(url) : new PrismaClient({ datasources: { db: { url } } });
    // busy from the start: its migration is work in progress
    const created: Entry = { client, ready, busy: 1 };
    const release = () => {
      created.busy -= 1;
      evictIdle();
    };
    entry = created;
    open.set(url, created);
    // A database that went away (the project was deleted) is not kept open, and the
    // request that finds out is "not found". The first request after
    // DROP DATABASE ... WITH (FORCE) sees its connection closed, not a missing database,
    // so a lost connection asks the cluster whether the database is still there.
    client.$use(async (params, next) => {
      created.busy += 1;
      try {
        return await next(params);
      } catch (err) {
        if (isMissingDatabase(err)) {
          migrated.delete(url);
          forget(url, created);
          notFound();
        }
        if (isLostConnection(err)) {
          migrated.delete(url);
          forget(url, created);
          if ((await databaseExists(pid)) === false) notFound();
        }
        throw err;
      } finally {
        release();
      }
    });
    // An interactive transaction holds its connection between its queries: busy until it ends.
    const transaction = client.$transaction.bind(client) as (...args: unknown[]) => Promise<unknown>;
    (client as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> }).$transaction = (...args) => {
      created.busy += 1;
      return Promise.resolve(transaction(...args)).finally(release);
    };
    ready.then(release, () => {
      created.busy -= 1;
      forget(url, created);
    });
    evictIdle();
  }
  await entry.ready;
  return entry.client;
}

/** Every open client, disconnected. For tests and shutdown. */
export async function closeProjectDatabases(): Promise<void> {
  const entries = [...open.values()];
  open.clear();
  migrated.clear();
  await Promise.all(entries.map((e) => e.client.$disconnect().catch(() => {})));
}

/**
 * This project's database, if the platform admits the caller to read it (or,
 * with write, change it):
 *
 * - not in the project, or not a pid at all → notFound()
 * - a reader asking to write, or the platform not answering → Refused, with the platform's words
 *
 * Nothing is connected to until the caller is admitted, and then only the admitted pid.
 */
export async function projectDbFor(pid: string, { write }: { write: boolean }): Promise<PrismaClient> {
  notFoundUnlessProject(pid);
  const admission = await callerAccess(pid, write ? "POST" : "GET");
  if (!admission.ok) {
    if (admission.status === 404) return notFound();
    throw new Refused(admission.message);
  }
  try {
    return await prismaFor(admission.pid);
  } catch (err) {
    // Opening migrates first; for a database that is not there, `migrate deploy` fails
    // (it may even try to create it, and is refused), so the cluster is asked.
    await notFoundIfGone(admission.pid, err);
    throw err;
  }
}

/** What the platform says the person behind this request may do in this project. For a
 *  page deciding what to show; what is allowed is enforced by projectDbFor. */
export async function callerAccess(pid: string, method = "GET"): Promise<Admission> {
  return admit(pid, method, await callerToken(), { platformUrl: platformUrl() });
}

/** The state an action returns when it was refused, or null for any other error. */
function refusal(err: unknown): { error: string } | null {
  return err instanceof Refused ? { error: err.message } : null;
}

/** For an action that returns a state: the database, or the refusal to return. */
export async function writableProject(
  pid: string,
): Promise<{ prisma: PrismaClient; refused?: undefined } | { prisma?: undefined; refused: { error: string } }> {
  try {
    return { prisma: await projectDbFor(pid, { write: true }) };
  } catch (err) {
    const refused = refusal(err);
    if (refused) return { refused };
    throw err;
  }
}
