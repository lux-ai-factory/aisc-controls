// Every vendored file must be its shared original. Skipped outside the aisc monorepo, where
// shared/ is not checked out next to this app.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = join(__dirname, "..", "..");
const shared = join(app, "..", "..", "shared");

const COPIES: [string, string][] = [
  ["src/vendor/aisc-access/projectAccess.ts", "access-ts/projectAccess.ts"],
  ["test/vendor/projectAccess.test.ts", "access-ts/projectAccess.test.ts"],
  ["src/vendor/aisc-access/projectDb.mjs", "access-ts/projectDb.mjs"],
  ["src/vendor/aisc-access/projectDb.d.mts", "access-ts/projectDb.d.mts"],
  ["test/vendor/projectDb.test.ts", "access-ts/projectDb.test.ts"],
  ["test/fixtures/projectdb-cases.json", "identity/projectdb-cases.json"],
  ...["emit", "canonical", "gatewayToken"].map((f): [string, string] => [
    `src/vendor/aisc-ledger/${f}.ts`, `ledger-ts/${f}.ts`]),
  ...["canonical", "emit", "jwksTimeout", "requestIdThroughGateway"].map((f): [string, string] => [
    `test/vendor/ledger/${f}.test.ts`, `ledger-ts/${f}.test.ts`]),
];

describe.skipIf(!existsSync(shared))("vendored shared code", () => {
  it.each(COPIES)("%s is shared/%s", (vendored, original) => {
    expect(readFileSync(join(app, vendored), "utf8")).toBe(readFileSync(join(shared, original), "utf8"));
  });
});
