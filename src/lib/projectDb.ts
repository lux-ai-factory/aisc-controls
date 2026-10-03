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

import { decide, fetchAccess, READ_ONLY, type Access } from "@/lib/access/projectAccess";
import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";

const run = promisify(execFile);

/** A project id (pid): a UUID, which is what names a project's database. */
export const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NotAProject extends Error {}

/** The caller may not do this here; the message is fit to show them. */
export class Refused extends Error {}

export const PLATFORM_SILENT =
  "The platform is not answering, so who may change this project cannot be established. Nothing was changed.";

export function projectDatabaseName(pid: string): string {
  if (!PROJECT_ID.test(pid)) throw new NotAProject(`not a project id: ${JSON.stringify(pid)}`);
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
export async function migrateProjectDatabase(url: string): Promise<void> {
  await run("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
  });
}

/**
 * How many project databases this process keeps a client open to.
 *
 * Each client holds up to connection_limit=2 connections, so this is the
 * connection budget: 2 × 20 = 40 at most. The least recently used client is
 * disconnected when a 21st project is opened, and reconnects if it is needed
 * again.
 */
export const MAX_OPEN_PROJECTS = 20;

type Entry = { client: PrismaClient; ready: Promise<void> };
const store = globalThis as unknown as { projectDatabases?: Map<string, Entry> };
const open = (store.projectDatabases ??= new Map<string, Entry>());

function forget(url: string, entry: Entry) {
  if (open.get(url) === entry) open.delete(url);
  entry.client.$disconnect().catch(() => {});
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
  deps: { migrate: (url: string) => Promise<void> } = { migrate: migrateProjectDatabase },
): Promise<PrismaClient> {
  const url = projectDatabaseUrl(pid);
  let entry = open.get(url);
  if (entry) {
    // Most recently used goes last; the first in the map is the one to evict.
    open.delete(url);
    open.set(url, entry);
  } else {
    const ready = deps.migrate(url);
    const client = new PrismaClient({ datasources: { db: { url } } });
    const created: Entry = { client, ready };
    entry = created;
    open.set(url, created);
    // A database that went away (the project was deleted) is not kept open, and the
    // request that finds out is "not found". The first request after
    // DROP DATABASE ... WITH (FORCE) sees its connection closed, not a missing database,
    // so a lost connection asks the cluster whether the database is still there.
    client.$use(async (params, next) => {
      try {
        return await next(params);
      } catch (err) {
        if (isMissingDatabase(err)) {
          forget(url, created);
          notFound();
        }
        if (isLostConnection(err)) {
          forget(url, created);
          if ((await databaseExists(pid)) === false) notFound();
        }
        throw err;
      }
    });
    ready.catch(() => forget(url, created));
    while (open.size > MAX_OPEN_PROJECTS) {
      const [oldestUrl, oldest] = open.entries().next().value as [string, Entry];
      forget(oldestUrl, oldest);
    }
  }
  await entry.ready;
  return entry.client;
}

/** Every open client, disconnected. For tests and shutdown. */
export async function closeProjectDatabases(): Promise<void> {
  const entries = [...open.values()];
  open.clear();
  await Promise.all(entries.map((e) => e.client.$disconnect().catch(() => {})));
}

/**
 * This project's database, if the caller may read it (or, with write, change
 * it). The platform decides, through the same decide() the middleware uses:
 *
 * - not in the project, or not a pid at all → notFound()
 * - a reader asking to write → Refused(READ_ONLY)
 * - the platform not answering → Refused(PLATFORM_SILENT)
 *
 * Nothing is connected to until the answer is "allow".
 */
export async function projectDbFor(pid: string, { write }: { write: boolean }): Promise<PrismaClient> {
  notFoundUnlessProject(pid);
  const access = await callerAccess(pid);
  switch (decide(write ? "POST" : "GET", access)) {
    case "allow":
      try {
        return await prismaFor(pid);
      } catch (err) {
        // Opening migrates first; for a database that is not there, `migrate deploy` fails
        // (it may even try to create it, and is refused), so the cluster is asked.
        await notFoundIfGone(pid, err);
        throw err;
      }
    case "not-found":
      return notFound();
    case "forbidden":
      throw new Refused(READ_ONLY);
    case "unavailable":
      throw new Refused(PLATFORM_SILENT);
  }
}

/** What the platform says the person behind this request may do in this
 *  project, or null when it does not answer. For a page deciding what to show;
 *  what is allowed is enforced by projectDbFor. */
export async function callerAccess(pid: string): Promise<Access | null> {
  return fetchAccess(pid, await callerToken(), { platformUrl: platformUrl() });
}

/** The state an action returns when it was refused, or null for any other error. */
export function refusal(err: unknown): { error: string } | null {
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
