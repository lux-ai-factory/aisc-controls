import { describe, it, expect, vi } from "vitest";
import { EXIT, migrateEach, projectDatabases, sweep, templateProblem } from "../../scripts/migrate-projects-lib.mjs";

const TEMPLATE = "postgresql://controls_rw:pw@postgres:5432/{database}?schema=controls";
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
    expect(result).toEqual({ migrated: 2, failed: [B] });
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
});
