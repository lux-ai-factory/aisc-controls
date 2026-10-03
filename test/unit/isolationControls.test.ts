import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAX_OPEN_PROJECTS } from "@/lib/projectDb";
import { fkMigration } from "../integration/isolationDb";

// Project isolation: static checks, no database.

describe("I6.1 / I17.1: controls keeps its routing and its connection budget", () => {
  it("I6.1: at most 20 project clients (LRU), as today", () => {
    expect(MAX_OPEN_PROJECTS).toBe(20);
  });

  it("I6.1 / I17.1: the project database template keeps connection_limit=2 and schema=controls", () => {
    const env = readFileSync(fileURLToPath(new URL("../../env.development", import.meta.url)), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("PROJECT_DATABASE_URL="));
    expect(line).toBeDefined();
    expect(line).toContain("{database}");
    expect(line).toContain("schema=controls");
    expect(line).toContain("connection_limit=2");
  });
});

describe("I6.2: an answer's version stamp is a real foreign key into project.system", () => {
  it("I6.2: a new migration adds submission_answer_system_version_pid_fkey", () => {
    const found = fkMigration();
    expect(found, "I6.2: no prisma migration adds submission_answer_system_version_pid_fkey").toBeDefined();
    // After the first three migrations.
    expect(found!.dir > "20260923210100_dashboard_reads_controls").toBe(true);
  });

  it("I6.2: it references project.system(pid) with ON DELETE NO ACTION", () => {
    const sql = fkMigration()?.sql ?? "";
    expect(sql).toMatch(/REFERENCES\s+"?project"?\s*\.\s*"?system"?\s*\(\s*"?pid"?\s*\)/i);
    expect(sql).toMatch(/ON DELETE NO ACTION/i);
    expect(sql).not.toMatch(/ON DELETE (CASCADE|SET NULL)/i);
  });

  it("I6.2: it checks for answers naming an absent version and refuses with a message", () => {
    const sql = fkMigration()?.sql ?? "";
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql).toMatch(/project\.system/);
  });
});
