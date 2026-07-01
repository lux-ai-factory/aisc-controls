import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auditEvent } from "@/lib/audit";

describe("controls auditEvent (server-side forwarder)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("POSTs to the backend /audit with the Bearer token and server-set action/resource_type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await auditEvent({
      token: "tok123", action: "answer", resource_type: "checklist",
      resource_id: "chk-1", metadata: { submissionId: "s1" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/audit");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok123");
    const body = JSON.parse(init.body);
    expect(body.action).toBe("answer");
    expect(body.resource_type).toBe("checklist");
    expect(body.resource_id).toBe("chk-1");
    expect(body.source_app).toBe("controls");
    expect(body.metadata).toEqual({ submissionId: "s1" });
    expect(body.outcome).toBe("ok");
  });

  it("does nothing when there is no token (never breaks the action)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await auditEvent({ token: null, action: "answer", resource_type: "checklist" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws if the backend call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("backend down")));
    await expect(
      auditEvent({ token: "t", action: "x", resource_type: "y" }),
    ).resolves.toBeUndefined();
  });
});
