import { describe, it, expect, vi } from "vitest";
import { writableProjects } from "@/lib/writableProjects";

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("writableProjects", () => {
  it("lists the projects this person may change, and not the ones they may only read", async () => {
    const fetchImpl = reply([
      { pid: A, name: "Alpha", role: "owner" },
      { pid: B, name: "Beta", role: "viewer" },
      { pid: C, name: "Gamma", role: "editor" },
    ]);
    const got = await writableProjects("tok", { platformUrl: "http://platform:8000/", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("http://platform:8000/projects", expect.objectContaining({ headers: { Authorization: "Bearer tok" } }));
    expect(got).toEqual([{ pid: A, name: "Alpha" }, { pid: C, name: "Gamma" }]);
  });

  it("gives an admin every project: the platform lists them without a role", async () => {
    const got = await writableProjects("tok", { platformUrl: "http://p", fetchImpl: reply([{ pid: A, name: "Alpha" }]) });
    expect(got).toEqual([{ pid: A, name: "Alpha" }]);
  });

  it("is null when the platform does not answer, so nothing is guessed", async () => {
    expect(await writableProjects("tok", { platformUrl: "http://p", fetchImpl: reply({}, 503) })).toBeNull();
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await writableProjects("tok", { platformUrl: "http://p", fetchImpl: down })).toBeNull();
    expect(await writableProjects("tok", { platformUrl: "", fetchImpl: reply([]) })).toBeNull();
  });
});
