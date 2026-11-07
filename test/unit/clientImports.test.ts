// A "use client" file is bundled for the browser, so nothing it imports, directly or through other
// files, may reach server-only code. Vitest runs on Node and would not notice; `next build` fails.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..", "..", "src");
const SERVER_ONLY = [/^node:/, /^@prisma\/client$/, /vendor\/aisc-ledger\//, /^@\/lib\/projectDb$/];
// a static import, a re-export (export {..} / * / * as ns from) and a dynamic import(): m[1] marks a type-only one
const IMPORT = new RegExp([
  /^\s*import\s+(type\s+)?[^"']*?from\s+["']([^"']+)["']/.source,
  /^\s*import\s+["']([^"']+)["']/.source,
  /^\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+["']([^"']+)["']/.source,
  /\bimport\(\s*["']([^"']+)["']\s*\)/.source,
].join("|"), "gm");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// The server-only imports reachable from `file` through value imports (type-only imports are erased).
// A "use server" file is not bundled: the browser calls it, so the walk stops there.
function reachesServer(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(file, "utf8");
  if (/^\s*["']use server["']/.test(text)) return [];
  const found: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    if (m[1] || m[4]) continue;
    const spec = m[2] ?? m[3] ?? m[5] ?? m[6];
    if (SERVER_ONLY.some((rule) => rule.test(spec))) found.push(`${file.slice(SRC.length + 1)} imports ${spec}`);
    const local = resolveLocal(spec, file);
    if (local) found.push(...reachesServer(local, seen));
  }
  return found;
}

const clientFiles = files(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));

describe("client components", () => {
  it("are found", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });
  it.each(clientFiles.map((f) => [f.slice(SRC.length + 1), f]))("%s reaches no server-only code", (_, file) => {
    expect(reachesServer(file)).toEqual([]);
  });
});

describe("the walk", () => {
  function walk(client: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), "client-imports-"));
    try {
      writeFileSync(join(dir, "server.ts"), 'import { PrismaClient } from "@prisma/client";\nexport const db = PrismaClient;\n');
      writeFileSync(join(dir, "client.tsx"), `"use client";\n${client}\n`);
      return reachesServer(join(dir, "client.tsx"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  it("follows a re-export", () => {
    expect(walk('export { db } from "./server";')).not.toEqual([]);
    expect(walk('export * from "./server";')).not.toEqual([]);
  });
  it("follows a dynamic import", () => {
    expect(walk('export async function load() { return (await import("./server")).db; }')).not.toEqual([]);
  });
  it("skips a type-only re-export", () => {
    expect(walk('export type { Db } from "./server";')).toEqual([]);
  });
});
