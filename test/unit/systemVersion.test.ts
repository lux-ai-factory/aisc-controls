import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// latestVersion(pid, token) in src/lib/systemVersion.ts asks the platform which
// saved AI card version is the latest, so an answer can carry it. It never
// throws: when the platform does not answer, the answer is saved unstamped.

const PID = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const V2 = "9b0e0d4c-2f1a-4c8e-8a3b-6d5e4f3a2b1c";

const state: { status: number; body: unknown; delayMs: number; seen: { path?: string; auth?: string }[] } = {
  status: 200,
  body: null,
  delayMs: 0,
  seen: [],
};
let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    state.seen.push({ path: req.url, auth: req.headers.authorization });
    setTimeout(() => {
      res.writeHead(state.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.body));
    }, state.delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PLATFORM_URL = url;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.status = 200;
  state.body = null;
  state.delayMs = 0;
  state.seen = [];
});

const load = () => import("@/lib/systemVersion");

describe("latestVersion (WP10)", () => {
  it("S10.1: returns the platform's latest version as {pid, number}", async () => {
    state.body = { pid: V2, project_id: PID, number: 2, name: "MCAS", created_by: "x" };
    const { latestVersion } = await load();
    expect(await latestVersion(PID, "tok")).toEqual({ pid: V2, number: 2 });
    expect(state.seen[0].path).toBe(`/projects/${PID}/system-versions/latest`);
  });

  it("S10.1: asks with the caller's token", async () => {
    state.body = { pid: V2, number: 2 };
    const { latestVersion } = await load();
    await latestVersion(PID, "the-callers-token");
    expect(state.seen[0].auth).toBe("Bearer the-callers-token");
  });

  it("is null when the project has no version yet (200 null)", async () => {
    state.body = null;
    const { latestVersion } = await load();
    expect(await latestVersion(PID, "tok")).toBeNull();
  });

  it("S10.2: is null, and warns, when the platform errors", async () => {
    state.status = 500;
    state.body = { detail: "down" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { latestVersion } = await load();
    expect(await latestVersion(PID, "tok")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("S10.2: is null when the platform is not there at all", async () => {
    const saved = process.env.PLATFORM_URL;
    process.env.PLATFORM_URL = "http://127.0.0.1:1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { latestVersion } = await load();
      expect(await latestVersion(PID, "tok")).toBeNull();
    } finally {
      process.env.PLATFORM_URL = saved;
      warn.mockRestore();
    }
  });

  it("S10.2: gives up after 3 s and is null", async () => {
    state.delayMs = 6000;
    state.body = { pid: V2, number: 2 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { latestVersion } = await load();
    const started = Date.now();
    expect(await latestVersion(PID, "tok")).toBeNull();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(2500);
    expect(took).toBeLessThan(4500);
    warn.mockRestore();
  }, 10_000);
});
