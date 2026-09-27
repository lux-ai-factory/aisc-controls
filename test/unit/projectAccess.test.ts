import { describe, it, expect, vi } from "vitest";
import {
  decide,
  fetchAccess,
  projectFromPath,
} from "@/lib/access/projectAccess";

// A project belongs to the people in it. This app does not decide that: the
// platform does, and this is the thin part that asks and then maps the answer
// onto a status code. Keeping the decision in one place is what stops the six
// modules from each inventing their own idea of who may do what.
describe("which project a request is inside", () => {
  it("reads the slug out of the path", () => {
    expect(projectFromPath("/p/mcas/qualifications")).toBe("mcas");
    expect(projectFromPath("/p/mcas")).toBe("mcas");
  });

  it("decodes what the URL encoded", () => {
    expect(projectFromPath("/p/a%20b/x")).toBe("a b");
  });

  it("is null outside a project", () => {
    expect(projectFromPath("/")).toBeNull();
    expect(projectFromPath("/methodology")).toBeNull();
    expect(projectFromPath("/p/")).toBeNull();
  });
});

describe("what the answer means", () => {
  const member = { role: "viewer", admin: false, may_write: false };
  const editor = { role: "editor", admin: false, may_write: true };
  const stranger = { role: null, admin: false, may_write: false };

  it("a stranger is told the project does not exist", () => {
    // 404 and not 403: the slug is the project's name, often a customer's, and
    // 403 would confirm it exists.
    expect(decide("GET", stranger)).toBe("not-found");
    expect(decide("POST", stranger)).toBe("not-found");
  });

  it("a member may read", () => {
    expect(decide("GET", member)).toBe("allow");
    expect(decide("HEAD", member)).toBe("allow");
  });

  it("a viewer may not change anything", () => {
    // Every write in this app is a server action, which is a POST to the page
    // it is on, so this covers them all without naming one.
    expect(decide("POST", member)).toBe("forbidden");
    expect(decide("PUT", member)).toBe("forbidden");
    expect(decide("DELETE", member)).toBe("forbidden");
  });

  it("an editor may change things", () => {
    expect(decide("POST", editor)).toBe("allow");
  });

  it("no answer at all means unavailable, never allowed", () => {
    // If the platform cannot be reached, nobody gets in. Failing open here
    // would make an outage into an open door.
    expect(decide("GET", null)).toBe("unavailable");
    expect(decide("POST", null)).toBe("unavailable");
  });
});

describe("asking the platform", () => {
  it("asks about this project, carrying the caller's token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ role: "editor", admin: false, may_write: true }),
    });

    const access = await fetchAccess("mcas", "a-token", {
      platformUrl: "http://platform:8000",
      fetchImpl,
    });

    expect(access).toEqual({ role: "editor", admin: false, may_write: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://platform:8000/authz/projects/mcas");
    expect(init.headers.Authorization).toBe("Bearer a-token");
  });

  it("is null when the platform refuses or is not there", async () => {
    expect(
      await fetchAccess("mcas", "t", {
        platformUrl: "http://platform:8000",
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      }),
    ).toBeNull();

    expect(
      await fetchAccess("mcas", "t", {
        platformUrl: "http://platform:8000",
        fetchImpl: vi.fn().mockRejectedValue(new Error("no route to host")),
      }),
    ).toBeNull();
  });

  it("is null when nobody configured the platform", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchAccess("mcas", "t", { platformUrl: "", fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never sends an empty bearer header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role: null }) });
    await fetchAccess("mcas", null, { platformUrl: "http://platform:8000", fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
