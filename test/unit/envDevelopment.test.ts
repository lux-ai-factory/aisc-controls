import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// controls_rw has a generated password in the stack (the aisc repo's init/controls-role.sql and
// scripts/secrets.sh); the stack's compose sets PROJECT_DATABASE_URL with it. The role's old
// name-as-password must not stay in this file as if it still worked.
describe("env.development", () => {
  it("carries no password for controls_rw", () => {
    const text = readFileSync(join(process.cwd(), "env.development"), "utf8");
    const settings = text.split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("#"));
    expect(settings.filter((line) => /controls_rw:[^@]+@/.test(line))).toEqual([]);
  });

  // One database per project, in the controls schema, two connections each.
  it("keeps the project database template's {database}, schema=controls and connection_limit=2", () => {
    const text = readFileSync(join(process.cwd(), "env.development"), "utf8");
    const line = text.split("\n").find((l) => l.startsWith("PROJECT_DATABASE_URL="));
    expect(line).toBeDefined();
    expect(line).toContain("{database}");
    expect(line).toContain("schema=controls");
    expect(line).toContain("connection_limit=2");
  });
});
