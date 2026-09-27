import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// WP10 (pipeline 2026-09-23, 03-specs.md): every answer carries the AI card
// version that was the latest when it was answered. saveDraft still deletes
// and recreates the rows (D7), so an unchanged answer must carry its old stamp
// over, or every save would restamp every answer.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts). The platform
// is a stub HTTP server; who may write is mocked, as in submission-lifecycle.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string };
    err.redirectUrl = url;
    throw err;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/projectAccess")>()),
  fetchAccess: async () => ({ role: "editor", admin: false, may_write: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({
  GATEWAY_TOKEN_HEADER: "x-auth-request-access-token",
  callerToken: async () => "caller-token",
}));

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { prismaFor, projectDatabaseUrl, closeProjectDatabases } from "@/lib/projectDb";
import { saveDraft, reopenForAmendment } from "@/app/p/[project]/submissions/[id]/actions";
import { hasThrowawayDb, makeProject, dropProject, rows } from "./throwawayDb";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

/** What the stub platform says is the latest version; null = none; "down" = 500. */
const platform: { latest: { pid: string; number: number } | null | "down" } = { latest: null };
let server: Server;

type Stamp = { answer: string | null; score: number | null; pid: string | null; number: number | null; at: string | null };

/** The stamps of a submission's answers, by question, read with SQL so the
 *  test does not depend on the generated client knowing the new columns. */
function stamps(project: string, submissionId: string): Record<string, Stamp> {
  const out: Record<string, Stamp> = {};
  for (const line of rows(
    `SELECT "questionId", coalesce(answer, '<null>'), coalesce(score::text, '<null>'),
            coalesce(system_version_pid::text, '<null>'), coalesce(system_version_number::text, '<null>'),
            coalesce(answered_at::text, '<null>')
       FROM controls.submission_answer WHERE "submissionId" = '${submissionId}'`,
    project,
  )) {
    const [q, answer, score, pid, number, at] = line.split("|").map((v) => (v === "<null>" ? null : v));
    out[q as string] = {
      answer,
      score: score === null ? null : Number(score),
      pid,
      number: number === null ? null : Number(number),
      at,
    };
  }
  return out;
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === "object" && "redirectUrl" in err) return (err as { redirectUrl: string }).redirectUrl;
    throw err;
  }
  throw new Error("expected a redirect");
}

describe.skipIf(!hasThrowawayDb)("answers carry the system version (WP10)", () => {
  let project: string;
  let checklistId: string;
  let qA: string;
  let qB: string;

  async function draft(label = "Run") {
    const prisma = await prismaFor(project);
    return (await prisma.submission.create({ data: { checklistId, label } })).id;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (platform.latest === "down") {
        res.writeHead(500).end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(platform.latest && { ...platform.latest, project_id: project, name: "MCAS" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.PLATFORM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    project = makeProject();
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: {
        title: `C ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "A?" }, { order: 2, text: "B?" }] },
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    checklistId = checklist.id;
    qA = checklist.questions[0].id;
    qB = checklist.questions[1].id;
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("the migration 20260923210000_answers_carry_the_system_version is there", () => {
    const dir = fileURLToPath(
      new URL("../../prisma/migrations/20260923210000_answers_carry_the_system_version/migration.sql", import.meta.url),
    );
    expect(existsSync(dir)).toBe(true);
  });

  it("the three stamp columns exist, nullable, with no foreign key", () => {
    const cols = rows(
      `SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns
        WHERE table_schema = 'controls' AND table_name = 'submission_answer'
          AND column_name IN ('system_version_pid','system_version_number','answered_at') ORDER BY 1`,
      project,
    );
    expect(cols).toEqual([
      "answered_at:timestamp with time zone:YES",
      "system_version_number:integer:YES",
      "system_version_pid:uuid:YES",
    ]);
  });

  it("S10.1: A answered under v1, then B under v2: A keeps v1, B gets v2", async () => {
    const id = await draft();
    platform.latest = { pid: V1, number: 1 };
    expect(await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }))).toBeUndefined();

    platform.latest = { pid: V2, number: 2 };
    expect(
      await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4", [`a:${qB}`]: "No", [`s:${qB}`]: "1" })),
    ).toBeUndefined();

    const s = stamps(project, id);
    expect(s[qA]).toMatchObject({ pid: V1, number: 1 });
    expect(s[qB]).toMatchObject({ pid: V2, number: 2 });
    expect(s[qA].at).not.toBeNull();
    expect(s[qB].at).not.toBeNull();
  }, 60_000);

  it("S10.1: a changed answer is restamped with the version latest now", async () => {
    const id = await draft();
    platform.latest = { pid: V1, number: 1 };
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    platform.latest = { pid: V2, number: 2 };
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "2" }));
    expect(stamps(project, id)[qA]).toMatchObject({ score: 2, pid: V2, number: 2 });
  }, 60_000);

  it("S10.2: with the platform down the save succeeds, and new answers are unstamped", async () => {
    const id = await draft();
    platform.latest = "down";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" }));
    warn.mockRestore();
    expect(result).toBeUndefined();
    const s = stamps(project, id);
    expect(s[qA]).toMatchObject({ answer: "Yes", score: 3, pid: null, number: null });
    // It was answered now, even though the version could not be named.
    expect(s[qA].at).not.toBeNull();
  }, 60_000);

  it("S10.3: saving again with no change changes no stamp and no answered_at", async () => {
    const id = await draft();
    platform.latest = { pid: V1, number: 1 };
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const before = stamps(project, id);
    expect(before[qA].pid).toBe(V1);

    platform.latest = { pid: V2, number: 2 };
    await new Promise((r) => setTimeout(r, 20));
    await saveDraft(project, id, undefined, form({ label: "Run renamed", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    expect(stamps(project, id)).toEqual(before);
  }, 60_000);

  it("S10.5: amending a closed submission keeps each copied answer's stamp", async () => {
    const id = await draft();
    platform.latest = { pid: V1, number: 1 };
    await saveDraft(project, id, undefined, form({ label: "Run", intent: "close", [`a:${qA}`]: "Yes", [`s:${qA}`]: "4" }));
    const original = stamps(project, id);
    expect(original[qA].pid).toBe(V1);

    platform.latest = { pid: V2, number: 2 };
    const url = await captureRedirect(() => reopenForAmendment(project, id));
    const next = url.split("/").pop() as string;
    expect(next).not.toBe(id);
    expect(stamps(project, next)[qA]).toEqual(original[qA]);
  }, 60_000);
});

describe.skipIf(!hasThrowawayDb)("a project database made before WP10 (S10.4)", () => {
  let project: string;
  let tmp: string;

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("S10.4: gains the stamp columns when first opened, and its old answers are unstamped", async () => {
    project = makeProject();
    // Migrate it with only the migrations that existed before WP10.
    tmp = mkdtempSync(join(tmpdir(), "controls-pre-wp10-"));
    const prismaDir = fileURLToPath(new URL("../../prisma/", import.meta.url));
    cpSync(join(prismaDir, "schema.prisma"), join(tmp, "schema.prisma"));
    cpSync(join(prismaDir, "migrations", "migration_lock.toml"), join(tmp, "migrations", "migration_lock.toml"));
    cpSync(
      join(prismaDir, "migrations", "20260923120000_project_database"),
      join(tmp, "migrations", "20260923120000_project_database"),
      { recursive: true },
    );
    execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", join(tmp, "schema.prisma")], {
      env: { ...process.env, DATABASE_URL: projectDatabaseUrl(project) },
      stdio: "pipe",
    });
    rows(
      `INSERT INTO controls.source (id, slug, name, updated_at) VALUES ('s1','s1','S1', now());
       INSERT INTO controls.checklist (id, title, "sourceId", "controlTopic", updated_at) VALUES ('c1','C1','s1','T', now());
       INSERT INTO controls.checklist_question (id, "checklistId", "order", text) VALUES ('q1','c1',1,'Q?');
       INSERT INTO controls.submission (id, "checklistId", label, updated_at) VALUES ('sub1','c1','old', now());
       INSERT INTO controls.submission_answer (id, "submissionId", "questionId", answer, score) VALUES ('a1','sub1','q1','Yes',4);`,
      project,
    );

    await prismaFor(project); // first open: migrate on open

    expect(
      rows(
        `SELECT coalesce(system_version_pid::text,'-') || '|' || coalesce(system_version_number::text,'-') || '|' || coalesce(answered_at::text,'-')
           FROM controls.submission_answer WHERE id = 'a1'`,
        project,
      ),
    ).toEqual(["-|-|-"]);
  }, 120_000);
});
