import { describe, it, expect, vi, beforeEach } from "vitest";

// Amending a closed submission says why and who asked for it: both are stored
// on the new draft and carried by the event, and nothing is made without them.
const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: 0,
  events: [] as Record<string, unknown>[],
  transactions: 0,
  closed: null as unknown,
}));

vi.mock("@/lib/projectDb", () => ({
  projectDbFor: async () => ({
    $transaction: async (fn: (tx: unknown) => unknown) => {
      h.transactions += 1;
      return fn({
        $queryRaw: async () => [],
        submission: {
          findUnique: async () => h.closed,
          create: async (args: { data: Record<string, unknown> }) => {
            h.created.push(args.data);
            return { id: "new" };
          },
          update: async () => { h.updated += 1; },
        },
        submissionAnswer: { createMany: async () => ({ count: 0 }) },
      });
    },
  }),
  writableProject: async () => {},
}));
vi.mock("@/vendor/aisc-ledger/emit", () => ({ emitEvent: async (_tx: unknown, e: Record<string, unknown>) => { h.events.push(e); } }));
vi.mock("@/lib/proofFiles", () => ({ carryProofFiles: async () => {} }));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: async () => null }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "t" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));

import { reopenForAmendment } from "@/app/p/[project]/submissions/[id]/actions";

const REFUSAL = "Say why the answers are amended and who asked for it.";
const closedRow = () => ({
  id: "old", checklistId: "chk", label: "Acme", status: "Closed", version: 1, archivedAt: null,
  nextVersion: null, answers: [],
});

async function amend(reason: string, requestedBy: string) {
  try {
    await reopenForAmendment("p", "old", { reason, requestedBy });
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

beforeEach(() => {
  h.created = []; h.updated = 0; h.events = []; h.transactions = 0; h.closed = closedRow();
});

describe("amending a closed submission", () => {
  it("amending stores reason and requester on the new draft", async () => {
    expect(await amend("  Wrong date  ", " Dana, auditor ")).toBe("REDIRECT /p/p/submissions/new");
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ status: "Draft", version: 2, amendReason: "Wrong date", amendRequestedBy: "Dana, auditor" });
  });

  it("amending without a reason or requester is refused", async () => {
    for (const [reason, by] of [["", "Dana"], ["Wrong date", ""], ["   ", "  "]]) {
      expect(await amend(reason, by)).toBe(REFUSAL);
    }
    expect(h.transactions).toBe(0);
    expect(h.created).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("the reopened event carries reason and requested_by", async () => {
    await amend("Wrong date", "Dana");
    const e = h.events.find((x) => x.action === "controls.submission.reopened");
    expect(e?.details).toMatchObject({ next: "new", version: 2, reason: "Wrong date", requested_by: "Dana" });
  });

  it("the closed submission is unchanged", async () => {
    await amend("Wrong date", "Dana");
    expect(h.updated).toBe(0);
    expect(h.created.every((d) => d.previousVersionId === "old")).toBe(true);
  });
});
