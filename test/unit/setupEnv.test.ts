import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureWebToPdfToken, withWebToPdfToken } from "../../scripts/setup-env-lib.mjs";

// Standalone, `npm run dev` gives the app and the bundled PDF renderer one
// CONTROLS_WEB_TO_PDF_TOKEN, written into .env by scripts/setup-once.mjs.

const token = () => "f".repeat(64);

describe("the PDF renderer's token in a standalone .env", () => {
  it("is added when .env has none", () => {
    const { text, written } = withWebToPdfToken('PLATFORM_URL=""\n', token);
    expect(written).toBe(true);
    expect(text).toBe(`PLATFORM_URL=""\nCONTROLS_WEB_TO_PDF_TOKEN="${"f".repeat(64)}"\n`);
  });

  it("fills an empty one in place", () => {
    const { text, written } = withWebToPdfToken('A=1\nCONTROLS_WEB_TO_PDF_TOKEN=""\nB=2\n', token);
    expect(written).toBe(true);
    expect(text).toBe(`A=1\nCONTROLS_WEB_TO_PDF_TOKEN="${"f".repeat(64)}"\nB=2\n`);
  });

  it("keeps one that is set", () => {
    const before = 'CONTROLS_WEB_TO_PDF_TOKEN="mine"\n';
    expect(withWebToPdfToken(before, token)).toEqual({ text: before, written: false });
  });

  it("is not taken from a commented line", () => {
    const { text, written } = withWebToPdfToken('# CONTROLS_WEB_TO_PDF_TOKEN="old"', token);
    expect(written).toBe(true);
    expect(text).toBe(`# CONTROLS_WEB_TO_PDF_TOKEN="old"\nCONTROLS_WEB_TO_PDF_TOKEN="${"f".repeat(64)}"\n`);
  });

  it("is random by default, and written to the file once", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "controls-env-"));
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "A=1\n");
    expect(ensureWebToPdfToken(envFile)).toBe(true);
    const first = readFileSync(envFile, "utf8");
    expect(first).toMatch(/^A=1\nCONTROLS_WEB_TO_PDF_TOKEN="[0-9a-f]{64}"\n$/);
    expect(ensureWebToPdfToken(envFile)).toBe(false);
    expect(readFileSync(envFile, "utf8")).toBe(first);
  });

  it("writes nothing when there is no .env", () => {
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), "controls-env-")), ".env");
    expect(ensureWebToPdfToken(envFile)).toBe(false);
    expect(existsSync(envFile)).toBe(false);
  });

  it("is what the bundled PDF renderer reads, from the same .env", () => {
    const compose = readFileSync(path.resolve(__dirname, "../../docker-compose.yml"), "utf8");
    const pdf = compose.slice(compose.indexOf("\n  pdf:"), compose.indexOf("\nvolumes:"));
    expect(pdf).toMatch(/\n {6}CONTROLS_WEB_TO_PDF_TOKEN: \$\{CONTROLS_WEB_TO_PDF_TOKEN:-\}\n/);
  });

  it("is written by the setup before the renderer starts", () => {
    const setup = readFileSync(path.resolve(__dirname, "../../scripts/setup-once.mjs"), "utf8");
    const written = setup.indexOf("ensureWebToPdfToken(envFile)");
    expect(written).toBeGreaterThan(-1);
    expect(written).toBeLessThan(setup.indexOf('"up", "-d", "pdf"'));
  });
});
