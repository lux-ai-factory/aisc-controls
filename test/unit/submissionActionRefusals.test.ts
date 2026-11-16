import { describe, it, expect, vi, beforeEach } from "vitest";

// Amend, archive, restore and discard say why they were refused, in the page's own words, instead of
// throwing to the generic error page (where the typed amend reason is gone and "Try again" only renders
// the same page again).
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const READ_ONLY = "You can read this project but not change it.";

const h = vi.hoisted(() => ({ mayWrite: false }));

vi.mock("next/headers", () => ({ headers: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "caller-token" }));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>()),
  admit: vi.fn(async (pid: string, method: string) =>
    method !== "GET" && !h.mayWrite
      ? { ok: false, status: 403, message: READ_ONLY }
      : { ok: true, pid, slug: pid, role: "viewer", admin: false, mayWrite: h.mayWrite }),
}));

import {
  reopenForAmendment,
  archiveSubmission,
  restoreSubmission,
  discardDraft,
} from "@/app/p/[project]/submissions/[id]/actions";

/** What an action gave back, or what it threw. */
async function outcome(run: () => Promise<unknown>): Promise<{ returned: unknown } | { thrown: string }> {
  try {
    return { returned: await run() };
  } catch (err) {
    return { thrown: err instanceof Error ? err.message : String(err) };
  }
}

beforeEach(() => {
  h.mayWrite = false;
});

describe("a refused write on a submission", () => {
  it("an amendment a viewer asks for returns the platform's reason", async () => {
    const got = await outcome(() =>
      reopenForAmendment(P1, "s1", { reason: "Corrections", requestedBy: "The provider" }));
    expect(got).toEqual({ returned: { error: READ_ONLY } });
  });

  it("an amendment without its reason returns what is missing", async () => {
    h.mayWrite = true;
    const got = await outcome(() => reopenForAmendment(P1, "s1", { reason: " ", requestedBy: "The provider" }));
    expect(got).toEqual({ returned: { error: "Say why the answers are amended and who asked for it." } });
  });

  it("archiving returns the platform's reason", async () => {
    expect(await outcome(() => archiveSubmission(P1, "s1"))).toEqual({ returned: { error: READ_ONLY } });
  });

  it("restoring returns the platform's reason", async () => {
    expect(await outcome(() => restoreSubmission(P1, "s1"))).toEqual({ returned: { error: READ_ONLY } });
  });

  it("discarding returns the platform's reason", async () => {
    expect(await outcome(() => discardDraft(P1, "s1"))).toEqual({ returned: { error: READ_ONLY } });
  });
});
