import { describe, it, expect, vi, beforeEach } from "vitest";

// A new submission's label was not trimmed, so "   " made a submission with a blank
// title, which the next "Save draft" then refused ("Label cannot be empty."). The two paths now agree.

const h = vi.hoisted(() => ({ created: [] as Array<{ label: string }> }));

const tx = {
  $queryRaw: vi.fn(async () => []),
  question: { findMany: vi.fn(async () => [{ id: "q1" }]) },
  submission: {
    create: vi.fn(async ({ data }: { data: { label: string } }) => {
      h.created.push({ label: data.label });
      return { id: "sub1" };
    }),
  },
};
const prisma = {
  checklist: { findUnique: vi.fn(async () => ({ id: "chk", questions: [{ id: "q1" }] })) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};

vi.mock("@/lib/projectDb", () => ({ writableProject: vi.fn(async () => ({ prisma })) }));
vi.mock("@/vendor/aisc-ledger/emit", () => ({ emitEvent: vi.fn(async () => null) }));
vi.mock("@/lib/systemVersion", () => ({ latestVersion: vi.fn(async () => null) }));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url });
  },
}));

import { submitForm } from "@/app/p/[project]/checklists/[id]/fill/actions";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const form = (label: string) => {
  const fd = new FormData();
  fd.set("label", label);
  return fd;
};

beforeEach(() => {
  h.created = [];
});

describe("a new submission's label", () => {
  it("a blank one is refused, and nothing is created", async () => {
    expect(await submitForm(P1, "chk", undefined, form("   "))).toEqual({ error: "Give this submission a name" });
    expect(h.created).toEqual([]);
  });

  it("is stored trimmed", async () => {
    await expect(submitForm(P1, "chk", undefined, form("  Acme  "))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.created).toEqual([{ label: "Acme" }]);
  });
});
