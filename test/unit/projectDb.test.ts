import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  MAX_OPEN_PROJECTS,
  NotAProject,
  closeProjectDatabases,
  isMissingDatabase,
  prismaFor,
  projectDatabaseName,
  projectDatabaseUrl,
} from "@/lib/projectDb";

const PID = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const TEMPLATE = "postgresql://controls_rw:pw@postgres:5432/{database}?schema=controls";

describe("the project database", () => {
  it("is named after the pid, as the platform names it", () => {
    // Same example as platform/tests/test_project_databases.py.
    expect(projectDatabaseName(PID)).toBe("project_3f2b8c1e0d4a4e7b9a551c2d3e4f5a6b");
    expect(projectDatabaseName(PID.toUpperCase())).toBe("project_3f2b8c1e0d4a4e7b9a551c2d3e4f5a6b");
  });

  it.each(["", "abc", "../platform", `${PID}x`, `${PID}\n`, "x'; drop database platform; --"])(
    "refuses %j before building anything",
    (bad) => {
      expect(() => projectDatabaseName(bad)).toThrow(NotAProject);
    },
  );

  it("fills the template", () => {
    expect(projectDatabaseUrl(PID, TEMPLATE)).toBe(
      "postgresql://controls_rw:pw@postgres:5432/project_3f2b8c1e0d4a4e7b9a551c2d3e4f5a6b?schema=controls",
    );
  });

  it("refuses a template with nowhere to put the database", () => {
    expect(() => projectDatabaseUrl(PID, "postgresql://x@y/platform")).toThrow(/\{database\}/);
  });
});

describe("prismaFor", () => {
  beforeEach(() => {
    vi.stubEnv("PROJECT_DATABASE_URL", TEMPLATE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("migrates a project's database once, however many requests arrive at once", async () => {
    const pid = "11111111-1111-4111-8111-111111111111";
    const migrate = vi.fn(() => new Promise<void>((r) => setTimeout(r, 20)));
    const [a, b] = await Promise.all([prismaFor(pid, { migrate }), prismaFor(pid, { migrate })]);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("tries again after a migration that failed", async () => {
    const pid = "22222222-2222-4222-8222-222222222222";
    const migrate = vi.fn().mockRejectedValueOnce(new Error("db starting")).mockResolvedValue(undefined);
    await expect(prismaFor(pid, { migrate })).rejects.toThrow("db starting");
    await expect(prismaFor(pid, { migrate })).resolves.toBeDefined();
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it("gives two projects two clients", async () => {
    const migrate = vi.fn(async () => {});
    const a = await prismaFor("33333333-3333-4333-8333-333333333333", { migrate });
    const b = await prismaFor("44444444-4444-4444-8444-444444444444", { migrate });
    expect(a).not.toBe(b);
  });

  it("disconnects failed client and creates new one on retry", async () => {
    const pid = "55555555-5555-4555-8555-555555555555";
    const disconnectSpy = vi.spyOn(PrismaClient.prototype, "$disconnect");
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection failed"))
      .mockResolvedValueOnce(undefined);

    // First call fails, client should be disconnected
    await expect(prismaFor(pid, { migrate })).rejects.toThrow("connection failed");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    // Second call succeeds with a new client
    const client = await prismaFor(pid, { migrate });
    expect(client).toBeDefined();
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(disconnectSpy).toHaveBeenCalledTimes(1); // Still only called once, on the failed one

    disconnectSpy.mockRestore();
  });
});

describe("the open project databases", () => {
  beforeEach(async () => {
    vi.stubEnv("PROJECT_DATABASE_URL", TEMPLATE);
    await closeProjectDatabases();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeProjectDatabases();
  });

  const pid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

  it("are at most 20, and the least recently used one is disconnected to make room", async () => {
    expect(MAX_OPEN_PROJECTS).toBe(20);
    const migrate = vi.fn(async () => {});
    const clients = [];
    for (let i = 0; i < MAX_OPEN_PROJECTS; i++) clients.push(await prismaFor(pid(i), { migrate }));
    const disconnected = clients.map((c) => vi.spyOn(c, "$disconnect").mockResolvedValue(undefined));

    await prismaFor(pid(0), { migrate }); // used again: now the most recent
    await prismaFor(pid(MAX_OPEN_PROJECTS), { migrate }); // the 21st

    expect(disconnected[1]).toHaveBeenCalledTimes(1);
    expect(disconnected.filter((d) => d.mock.calls.length > 0)).toHaveLength(1);
    expect(await prismaFor(pid(0), { migrate })).toBe(clients[0]);

    // The evicted one is opened afresh, migrated again, when it is next needed.
    const before = migrate.mock.calls.length;
    const reopened = await prismaFor(pid(1), { migrate });
    expect(reopened).not.toBe(clients[1]);
    expect(migrate.mock.calls.length).toBe(before + 1);
  });

  it("recognise a database that does not exist", () => {
    expect(isMissingDatabase({ errorCode: "P1003", message: "Database `project_x` does not exist" })).toBe(true);
    expect(isMissingDatabase({ code: "P1003" })).toBe(true);
    expect(isMissingDatabase(new Error('database "project_x" does not exist'))).toBe(true);
    expect(isMissingDatabase({ code: "P2002" })).toBe(false);
    expect(isMissingDatabase(new Error("connection refused"))).toBe(false);
    expect(isMissingDatabase(null)).toBe(false);
  });
});
