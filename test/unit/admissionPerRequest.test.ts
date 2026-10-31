import { describe, it, expect, vi, beforeEach } from "vitest";

// A page asks for admission from its layout, its own body and its components.
// Within one request the platform is asked once per project; a new request asks again.
const h = vi.hoisted(() => ({
  request: {} as object | null,
  allowWrite: true,
  calls: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!h.request) throw new Error("outside a request");
    return h.request;
  },
}));
vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "caller-token" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/vendor/aisc-access/projectAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/vendor/aisc-access/projectAccess")>();
  return {
    ...actual,
    admit: vi.fn(async (pid: string, method: string) => {
      h.calls.push(`${method}:${pid}`);
      if (method !== "GET" && !h.allowWrite) {
        return { ok: false, status: 403, message: "You can read this project but not change it." };
      }
      return { ok: true, pid, slug: pid, role: "owner", admin: false, mayWrite: h.allowWrite };
    }),
  };
});

import { callerAccess, writableProject } from "@/lib/projectDb";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.request = {};
  h.allowWrite = true;
  h.calls = [];
});

describe("admission within one request", () => {
  it("asks the platform once however many parts of the page ask", async () => {
    const answers = await Promise.all([callerAccess(A), callerAccess(A), callerAccess(A, "GET")]);
    await callerAccess(A);
    expect(h.calls).toEqual([`GET:${A}`]);
    expect(answers.every((a) => a.ok)).toBe(true);
  });

  it("asks again in the next request", async () => {
    await callerAccess(A);
    h.request = {};
    await callerAccess(A);
    expect(h.calls).toEqual([`GET:${A}`, `GET:${A}`]);
  });

  it("asks once per project", async () => {
    await callerAccess(A);
    await callerAccess(B);
    expect(h.calls).toEqual([`GET:${A}`, `GET:${B}`]);
  });

  it("lets a read reuse a write that was allowed, but not the other way round", async () => {
    await callerAccess(A, "POST");
    await callerAccess(A);
    expect(h.calls).toEqual([`POST:${A}`]);

    h.request = {};
    h.calls = [];
    await callerAccess(A);
    await callerAccess(A, "POST");
    expect(h.calls).toEqual([`GET:${A}`, `POST:${A}`]);
  });

  it("asks for a read when the write was refused", async () => {
    h.allowWrite = false;
    expect((await writableProject(A)).refused).toBeDefined();
    expect((await writableProject(A)).refused).toBeDefined();
    expect((await callerAccess(A)).ok).toBe(true);
    expect(h.calls).toEqual([`POST:${A}`, `GET:${A}`]);
  });

  it("asks every time outside a request, as a script does", async () => {
    h.request = null;
    await callerAccess(A);
    await callerAccess(A);
    expect(h.calls).toEqual([`GET:${A}`, `GET:${A}`]);
  });
});
