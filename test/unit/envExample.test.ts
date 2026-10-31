import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// setup-once copies .env.example to .env, so a variable the README's configuration table says the
// app reads should be there to find, set or commented out.
describe(".env.example", () => {
  const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  const named = (name: string) => new RegExp(`^#?\\s*${name}=`, "m").test(text);

  it.each(["LAUNCHER_URL", "CATALOGUE_ORIGIN", "LEDGER_MODE", "CONTROLS_WEB_TO_PDF_TOKEN"])(
    "names %s",
    (name) => {
      expect(named(name)).toBe(true);
    },
  );
});
