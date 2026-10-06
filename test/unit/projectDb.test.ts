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

    await expect(prismaFor(pid, { migrate })).rejects.toThrow("connection failed");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    const client = await prismaFor(pid, { migrate });
    expect(client).toBeDefined();
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(disconnectSpy).toHaveBeenCalledTimes(1); // only the failed one

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

  // A client whose queries run through the middleware prismaFor installs, and finish when the test says.
  function fakeClient() {
    type Middleware = (params: unknown, next: (params: unknown) => Promise<unknown>) => Promise<unknown>;
    const middlewares: Middleware[] = [];
    const client = {
      $use: (mw: Middleware) => { middlewares.push(mw); },
      $disconnect: vi.fn(async () => {}),
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
      query(work: () => Promise<unknown>) {
        const run = (i: number, params: unknown): Promise<unknown> =>
          i < middlewares.length ? middlewares[i](params, (next) => run(i + 1, next)) : work();
        return run(0, { model: "Checklist", action: "findMany" });
      },
    };
    return client;
  }
  function pending() {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return { done, finish };
  }
  async function openFakes(count: number, migrate: () => Promise<void>) {
    const fakes = [];
    for (let i = 0; i < count; i++) {
      const fake = fakeClient();
      await prismaFor(pid(i), { migrate, newClient: () => fake as never });
      fakes.push(fake);
    }
    return fakes;
  }

  it("never disconnects a client in the middle of a query to make room (F11)", async () => {
    const migrate = vi.fn(async () => {});
    const fakes = await openFakes(MAX_OPEN_PROJECTS, migrate);
    const query = pending();
    const running = fakes[0].query(() => query.done); // the least recently used, busy
    await prismaFor(pid(MAX_OPEN_PROJECTS), { migrate, newClient: () => fakeClient() as never }); // the 21st
    expect(fakes[0].$disconnect).not.toHaveBeenCalled();
    expect(fakes[1].$disconnect).toHaveBeenCalledTimes(1); // the oldest idle one made room
    query.finish();
    await running;
    expect(fakes[0].$disconnect).not.toHaveBeenCalled(); // back to 20: nothing more to evict
  });

  it("with every client busy, goes past 20 and comes back as queries end (F11)", async () => {
    const migrate = vi.fn(async () => {});
    const fakes = await openFakes(MAX_OPEN_PROJECTS, migrate);
    const queries = fakes.map(() => pending());
    const running = fakes.map((f, i) => f.query(() => queries[i].done));
    const newest = fakeClient();
    await prismaFor(pid(MAX_OPEN_PROJECTS), { migrate, newClient: () => newest as never });
    expect(fakes.every((f) => f.$disconnect.mock.calls.length === 0)).toBe(true);
    expect(newest.$disconnect).not.toHaveBeenCalled(); // the one just handed out, though it is the only idle one
    queries[0].finish();
    await running[0];
    expect(fakes[0].$disconnect).toHaveBeenCalledTimes(1); // idle now, and one too many open
    expect(fakes.slice(1).every((f) => f.$disconnect.mock.calls.length === 0)).toBe(true);
    queries.slice(1).forEach((q) => q.finish());
    await Promise.all(running);
  });

  it("keeps a client while a transaction on it is open, between its queries (F11)", async () => {
    const migrate = vi.fn(async () => {});
    const fakes = await openFakes(MAX_OPEN_PROJECTS, migrate);
    const tx = pending();
    const client = await prismaFor(pid(0), { migrate });
    const open = (client as unknown as { $transaction: (w: () => Promise<void>) => Promise<void> }).$transaction(() => tx.done);
    // the others used after it, so pid(0)'s client is the least recently used, and between two queries
    for (let i = 1; i < MAX_OPEN_PROJECTS; i++) await prismaFor(pid(i), { migrate });
    await prismaFor(pid(MAX_OPEN_PROJECTS), { migrate, newClient: () => fakeClient() as never });
    expect(fakes[0].$disconnect).not.toHaveBeenCalled();
    tx.finish();
    await open;
  });

  it("are at most 20, and the least recently used one is disconnected to make room", async () => {
    expect(MAX_OPEN_PROJECTS).toBe(20);
    const migrate = vi.fn(async () => {});
    const clients = [];
    for (let i = 0; i < MAX_OPEN_PROJECTS; i++) clients.push(await prismaFor(pid(i), { migrate }));
    const disconnected = clients.map((c) => vi.spyOn(c, "$disconnect").mockResolvedValue(undefined));

    await prismaFor(pid(0), { migrate }); // used again, so the most recent
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

  // `prisma migrate deploy` run through execFile fails with the
  // Prisma error in its output, not in a code the error object carries.
  it("recognise a missing database in a failed migration's output", () => {
    const failed = Object.assign(new Error("Command failed: npx prisma migrate deploy"), {
      stdout: "",
      stderr: "Error: P1003: Database `project_x` does not exist at `postgres:5432`",
    });
    expect(isMissingDatabase(failed)).toBe(true);
    expect(isMissingDatabase({ stdout: 'database "project_x" does not exist' })).toBe(true);
    expect(isMissingDatabase({ stderr: "Error: P1001: Can't reach database server" })).toBe(false);
  });

  it("do not take a lost connection, on its own, for a missing database", () => {
    expect(isMissingDatabase({ code: "P1001" })).toBe(false);
    expect(isMissingDatabase({ errorCode: "P1017", message: "Server has closed the connection." })).toBe(false);
    expect(isMissingDatabase(new Error("terminating connection due to administrator command"))).toBe(false);
  });
});
