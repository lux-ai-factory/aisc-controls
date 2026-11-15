import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// An answer is stamped with the AI card version that is the latest when it is saved. The stamp is
// read from project.system in the save's own transaction (the same project database), so a platform
// that is slow or silent never leaves a new answer unstamped, and a version saved meanwhile is the
// one an answer given after it carries. The stamp also names the card's revision.
//
// Runs only against a throwaway Postgres (see ./throwawayDb.ts). The platform is a stub HTTP server.

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
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: async (pid: string) => ({ ok: true, pid, slug: pid, role: "editor", admin: false, mayWrite: true }),
}));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "caller-token" }));

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { prismaFor, projectDatabaseName, closeProjectDatabases } from "@/lib/projectDb";
import { saveDraft } from "@/app/p/[project]/submissions/[id]/actions";
import { hasThrowawayDb, makeProject, dropProject, rows, su } from "./throwawayDb";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

/** What the stub platform answers for the latest version; "down" = 500. */
const platform: { latest: { pid: string; number: number } | "down" } = { latest: "down" };
let server: Server;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

function stampOf(project: string, submissionId: string, questionId: string): string | null {
  const [line] = rows(
    `SELECT coalesce(system_version_pid::text, '<null>') FROM controls.submission_answer
      WHERE "submissionId" = '${submissionId}' AND "questionId" = '${questionId}'`,
    project,
  );
  return line === undefined || line === "<null>" ? null : line;
}

describe.skipIf(!hasThrowawayDb)("an answer is stamped from the card the project holds", () => {
  let project: string;
  let checklistId: string;
  let qA: string;

  async function draft() {
    const prisma = await prismaFor(project);
    return (await prisma.submission.create({ data: { checklistId, label: "Run" } })).id;
  }

  beforeAll(async () => {
    server = createServer((_req, res) => {
      if (platform.latest === "down") {
        res.writeHead(500).end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...platform.latest, project_id: project, name: "Fake" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.PLATFORM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    project = makeProject();
    su(
      "SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES " + `('${V1}', 1, 'Fake')`,
      projectDatabaseName(project),
    );
    const prisma = await prismaFor(project);
    const tag = randomUUID().slice(0, 8);
    const source = await prisma.source.create({ data: { name: `S ${tag}`, slug: `s-${tag}` } });
    const checklist = await prisma.checklist.create({
      data: {
        title: `C ${tag}`,
        sourceId: source.id,
        controlTopic: "Testing",
        questions: { create: [{ order: 1, text: "A?" }] },
      },
      include: { questions: true },
    });
    checklistId = checklist.id;
    qA = checklist.questions[0].id;
  }, 120_000);

  afterAll(async () => {
    await closeProjectDatabases();
    if (project) dropProject(project);
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("a save while the platform does not answer is stamped with the latest version, or refused", async () => {
    platform.latest = "down";
    const id = await draft();
    const out = await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Yes", [`s:${qA}`]: "3" }));
    const outcome = out?.error ? "refused, nothing stored" : stampOf(project, id, qA);
    expect([V1, "refused, nothing stored"]).toContain(outcome);
    if (out?.error) expect(stampOf(project, id, qA)).toBeNull();
  });

  it("an answer saved after a new version was made carries that version, whatever the platform said before", async () => {
    // the platform still names version 1, but version 2 is already in the project's database
    platform.latest = { pid: V1, number: 1 };
    su(
      "SET ROLE platform_rw; INSERT INTO project.system (pid, number, name) VALUES " + `('${V2}', 2, 'Fake')`,
      projectDatabaseName(project),
    );
    const id = await draft();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "No", [`s:${qA}`]: "1" }));
    expect(stampOf(project, id, qA)).toBe(V2);
  });

  it("an answer carries the card revision of its version", async () => {
    platform.latest = { pid: V2, number: 2 };
    su(`UPDATE project.system SET card_revision = 2 WHERE pid = '${V2}'`, projectDatabaseName(project));
    const id = await draft();
    await saveDraft(project, id, undefined, form({ label: "Run", [`a:${qA}`]: "Maybe", [`s:${qA}`]: "2" }));
    const columns = rows(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'controls' AND table_name = 'submission_answer' AND column_name LIKE '%revision%'`,
      project,
    );
    expect(columns).toHaveLength(1);
    const [stored] = rows(
      `SELECT ${columns[0]}::text FROM controls.submission_answer WHERE "submissionId" = '${id}'`,
      project,
    );
    expect(stored).toBe("2");
  });
});
