import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// npm audit, 2026-10-06: Next before 15.5.27 has a denial of service in Server Components and a
// middleware bypass through segment-prefetch routes; sharp before 0.35.5 carries libvips and libheif
// CVEs. The installed versions, not only the ranges, so a lockfile pinning an old one fails too.
const installed = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "node_modules", name, "package.json"), "utf8")).version as string;
const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
const atLeast = (v: string, min: string) => {
  const [a, b] = [parts(v), parts(min)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe("dependencies carry the 2026 security fixes", () => {
  it("next is 15.5.27 or later", () => {
    expect(atLeast(installed("next"), "15.5.27"), installed("next")).toBe(true);
  });
  it("vitest is 4.1.11 or later (dev only: vitest 2 pulled tinypool and @vitest/mocker with critical advisories)", () => {
    expect(atLeast(installed("vitest"), "4.1.11"), installed("vitest")).toBe(true);
  });
  it("sharp is 0.35.5 or later", () => {
    expect(atLeast(installed("sharp"), "0.35.5"), installed("sharp")).toBe(true);
  });
});
