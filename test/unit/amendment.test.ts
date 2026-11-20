import { describe, it, expect, vi, beforeEach } from "vitest";

// Amending a closed submission makes its next version in one step: no reason and no requester are asked, so
// none is stored on the new draft or carried by the event.
const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: 0,
  events: [] as Record<string, unknown>[],
  transactions: 0,
  closed: null as unknown,
}));

vi.mock("@/lib/projectDb", () => ({
  writableProject: async () => ({ prisma: {
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
  } }),
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

const closedRow = () => ({
  id: "old", checklistId: "chk", label: "Acme", status: "Closed", version: 1, archivedAt: null,
  nextVersion: null, answers: [],
});

async function amend() {
  try {
    const refused = await reopenForAmendment("p", "old");
    if (refused?.error) return refused.error;
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

beforeEach(() => {
  h.created = []; h.updated = 0; h.events = []; h.transactions = 0; h.closed = closedRow();
});

describe("amending a closed submission", () => {
  it("makes the next version as a draft, with no reason or requester", async () => {
    expect(await amend()).toBe("REDIRECT /p/p/submissions/new");
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ status: "Draft", version: 2, amendReason: null, amendRequestedBy: null });
  });

  it("the reopened event names the next version and no reason or requester", async () => {
    await amend();
    const e = h.events.find((x) => x.action === "controls.submission.reopened");
    expect(e?.details).toMatchObject({ next: "new", version: 2, reason: null, requested_by: null });
  });

  it("the closed submission is unchanged", async () => {
    await amend();
    expect(h.updated).toBe(0);
    expect(h.created.every((d) => d.previousVersionId === "old")).toBe(true);
  });
});
