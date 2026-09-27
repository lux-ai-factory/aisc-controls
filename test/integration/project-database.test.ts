import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
}));

// These tests are about where the data goes, not who may put it there
// (test/integration/action-access.test.ts is): everybody is an editor.
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prismaFor, projectDatabaseName } from "@/lib/projectDb";
import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";
import { submissionsOfProject } from "@/lib/submissions";

// Two project databases, made the way the platform makes them, and dropped
// afterwards. Needs PROJECT_DATABASE_URL (pointing at 127.0.0.1). The SQL is
// run inside the postgres container, using its own env for the superuser
// role, so no password is handled here.
const hasDb = Boolean(process.env.PROJECT_DATABASE_URL);
const su = (sql: string, db = "platform") =>
  execSync(`docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -Atc "${sql}"'`);

function makeProject(): string {
  const pid = randomUUID();
  const db = projectDatabaseName(pid);
  su(`create database ${db}`);
  su(`grant connect on database ${db} to controls_rw`, db);
  su(`create schema controls; grant usage, create on schema controls to controls_rw`, db);
  return pid;
}

describe.skipIf(!hasDb)("a project's controls live in its own database", () => {
  let a: string;
  let b: string;

  beforeAll(() => {
    a = makeProject();
    b = makeProject();
  }, 60_000);

  afterAll(() => {
    for (const pid of [a, b]) su(`drop database if exists ${projectDatabaseName(pid)} with (force)`);
  });

  it("a checklist in one project is not in the other", async () => {
    const dbA = await prismaFor(a);
    const dbB = await prismaFor(b);
    const source = await dbA.source.create({ data: { name: "S", slug: "s" } });
    await dbA.checklist.create({
      data: { title: "Only in A", sourceId: source.id, controlTopic: "T", questions: { create: [{ order: 1, text: "Q?" }] } },
    });
    expect(await dbA.checklist.count()).toBe(1);
    expect(await dbB.checklist.count()).toBe(0);
  }, 60_000);

  it("an answered checklist is listed only in its own project", async () => {
    const dbA = await prismaFor(a);
    const checklist = await dbA.checklist.findFirstOrThrow({ include: { questions: true } });
    const fd = new FormData();
    fd.set("label", "first go");
    fd.set(`a:${checklist.questions[0].id}`, "yes");
    await submitForm(a, checklist.id, undefined, fd).catch(() => undefined); // redirects on success
    expect(await submissionsOfProject(a)).toHaveLength(1);
    expect(await submissionsOfProject(b)).toHaveLength(0);
  }, 60_000);

  it("a checklist id from one project is not found through the other", async () => {
    const dbA = await prismaFor(a);
    const checklist = await dbA.checklist.findFirstOrThrow();
    const fd = new FormData();
    fd.set("label", "sneaky");
    expect(await submitForm(b, checklist.id, undefined, fd)).toEqual({ error: "Checklist not found." });
  }, 60_000);

  it("a client whose database was dropped is not kept", async () => {
    const gone = makeProject();
    const client = await prismaFor(gone);
    expect(await client.checklist.count()).toBe(0);
    su(`drop database ${projectDatabaseName(gone)} with (force)`);
    // The pooled connection was cut, so the first query may only say that;
    // the one that reconnects finds the database missing.
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      last = await client.checklist.count().then(() => null, (err: unknown) => err);
      if (/does not exist/.test(String((last as Error)?.message))) break;
    }
    expect(String((last as Error)?.message)).toMatch(/does not exist/);
    // Forgotten: the next open is a new client (and a new migration, which a
    // real request would find failing, and report, rather than a stale client).
    const again = await prismaFor(gone, { migrate: async () => {} });
    expect(again).not.toBe(client);
  }, 60_000);
});
