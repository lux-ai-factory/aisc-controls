import { describe, it, expect, vi } from "vitest";
import { EXIT, migrateEach, ownerProblem, pgConnectionString, projectDatabases, sweep, templateProblem } from "../../scripts/migrate-projects-lib.mjs";

const TEMPLATE = "postgresql://controls_migrator:pw@postgres:5432/{database}?schema=controls";
const A = `project_${"a".repeat(32)}`;
const B = `project_${"b".repeat(32)}`;
const C = `project_${"c".repeat(32)}`;
const quiet = { log: vi.fn(), error: vi.fn() };

describe("the migration sweep at start", () => {
  it("stops for good on a template with nowhere to put the database", async () => {
    expect(templateProblem("postgresql://x@y/platform")).toMatch(/\{database\}/);
    expect(templateProblem(TEMPLATE)).toBeNull();
    const listDatabases = vi.fn();
    expect(await sweep({ template: "postgresql://x@y/platform", listDatabases, runner: vi.fn(), log: quiet })).toBe(EXIT.badConfig);
    expect(EXIT.badConfig).toBe(2);
    expect(listDatabases).not.toHaveBeenCalled();
  });

  it("migrates only project databases", () => {
    expect(projectDatabases(["platform", B, "postgres", A, "project_x", `${A}0`, "template1"])).toEqual([A, B]);
  });

  it("one project that fails does not stop the others", async () => {
    const runner = vi.fn(async (datname: string) => {
      if (datname === B) throw new Error("P3009 failed migration");
    });
    const result = await migrateEach([A, B, C], TEMPLATE, runner, quiet);
    expect(runner.mock.calls.map((c) => c[0])).toEqual([A, B, C]);
    expect(runner).toHaveBeenCalledWith(A, TEMPLATE.replace("{database}", A));
    expect(result).toEqual({ migrated: 2, failed: [B], waiting: [] });
    expect(quiet.log).toHaveBeenLastCalledWith(expect.stringMatching(/2 project database\(s\) up to date, 1 failed/));
  });

  it("exits 0 when every database was tried, even if one failed", async () => {
    const runner = vi.fn(async (datname: string) => {
      if (datname === A) throw new Error("boom");
    });
    const code = await sweep({ template: TEMPLATE, listDatabases: async () => ["platform", A, B], runner, log: quiet });
    expect(code).toBe(EXIT.done);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("asks to be run again when postgres cannot be listed yet", async () => {
    const code = await sweep({
      template: TEMPLATE,
      listDatabases: async () => { throw new Error("ECONNREFUSED"); },
      runner: vi.fn(),
      log: quiet,
    });
    expect(code).toBe(EXIT.retry);
  });

  it("lists the databases with the template's connection options, without Prisma's own", () => {
    const template = "postgresql://controls_migrator:pw@postgres:5432/{database}?schema=controls&connection_limit=2&sslmode=require&pool_timeout=10";
    expect(pgConnectionString(template.replace("{database}", "postgres"))).toBe("postgresql://controls_migrator:pw@postgres:5432/postgres?sslmode=require");
    expect(pgConnectionString(TEMPLATE.replace("{database}", "postgres"))).toBe("postgresql://controls_migrator:pw@postgres:5432/postgres");
  });

  it("names the migrator's template, not the app's, when it has nowhere to put the database", () => {
    expect(templateProblem("")).toMatch(/PROJECT_MIGRATE_DATABASE_URL/);
  });

  it("migrates a schema only once it is controls_owner's", () => {
    expect(ownerProblem("controls_owner")).toBeNull();
    for (const notYet of [null, "platform_rw", "platform_owner"]) {
      expect(ownerProblem(notYet)).toMatchObject({ wait: true, text: expect.stringMatching(/postgres-setup/) });
    }
    expect(ownerProblem("controls_rw")).toMatchObject({ wait: false, text: expect.stringMatching(/controls_owner/) });
  });

  it("waits and tries again while a schema has not been handed to its owner, saying why", async () => {
    const runner = vi.fn(async (datname: string) => {
      if (datname === B) throw Object.assign(new Error("schema controls belongs to platform_rw"), { wait: true });
    });
    const log = { log: vi.fn(), error: vi.fn() };
    const code = await sweep({ template: TEMPLATE, listDatabases: async () => [A, B, C], runner, log });
    expect(code).toBe(EXIT.retry);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenLastCalledWith(expect.stringMatching(/postgres-setup/));
  });

  it("migrates only the databases it is given, and says so by its exit when one fails", async () => {
    const listDatabases = vi.fn();
    const runner = vi.fn(async (datname: string) => {
      if (datname === A) throw new Error("boom");
    });
    expect(await sweep({ template: TEMPLATE, listDatabases, runner, names: [A], log: quiet })).toBe(EXIT.badConfig);
    expect(listDatabases).not.toHaveBeenCalled();
    expect(await sweep({ template: TEMPLATE, listDatabases, runner, names: [B], log: quiet })).toBe(EXIT.done);
    expect(await sweep({ template: TEMPLATE, listDatabases, runner, names: ["platform"], log: quiet })).toBe(EXIT.badConfig);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
