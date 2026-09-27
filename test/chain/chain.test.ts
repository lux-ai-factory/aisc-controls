import { describe, it, expect, afterAll, vi } from "vitest";

// Controls' steps of the pipeline chain (scripts/test-pipeline-chain.sh, 03 WP12).
// Skipped unless CHAIN_JSON names the chain's shared state. Only PROJECT_DATABASE_URL
// (the throwaway server, set by the driver) and CHAIN_* are used: never
// `docker exec postgres`.
//   chain_step5: a control installed from the catalogue into the project's database.
//   chain_step7: an answer saved while v2 is the latest carries v2.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url });
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
  callerToken: async () => "chain-caller",
}));

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";

import { installChecklist } from "@/lib/installChecklist";
import { prismaFor, closeProjectDatabases } from "@/lib/projectDb";
import { saveDraft } from "@/app/p/[project]/submissions/[id]/actions";

const CHAIN_JSON = process.env.CHAIN_JSON ?? "";
const state = () => JSON.parse(readFileSync(CHAIN_JSON, "utf8"));
const write = (keys: Record<string, unknown>) =>
  writeFileSync(CHAIN_JSON, JSON.stringify({ ...state(), ...keys }));

describe.skipIf(!CHAIN_JSON)("pipeline chain", () => {
  afterAll(async () => {
    await closeProjectDatabases();
  });

  it("chain_step5 a checklist installed with its catalogueId", async () => {
    const s = state();
    const db = await prismaFor(s.project_pid);
    const installed = await installChecklist(db, {
      meta: { catalogueId: "chain-checklist", title: "Chain", sourceName: "AESIA", controlTopic: "Accuracy" },
      questions: [{ text: "Is the model accurate enough?" }],
    });
    expect(installed.catalogueId).toBe("chain-checklist");
    write({ checklist_id: installed.checklistId });
  }, 120_000);

  it("chain_step7 an answer saved under v2 carries v2", async () => {
    const s = state();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pid: s.v2_pid, project_id: s.project_pid, number: 2 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.PLATFORM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const db = await prismaFor(s.project_pid);
      const question = await db.question.findFirstOrThrow({ where: { checklistId: s.checklist_id } });
      const submission = await db.submission.create({ data: { checklistId: s.checklist_id, label: "chain" } });
      const form = new FormData();
      form.set("label", "chain");
      form.set(`a:${question.id}`, "Yes");
      form.set(`s:${question.id}`, "4");
      expect(await saveDraft(s.project_pid, submission.id, undefined, form)).toBeUndefined();
      const answer = await db.submissionAnswer.findFirstOrThrow({ where: { submissionId: submission.id } });
      expect(answer.systemVersionPid).toBe(s.v2_pid);
      expect(answer.systemVersionNumber).toBe(2);
      write({ submission_id: submission.id });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
