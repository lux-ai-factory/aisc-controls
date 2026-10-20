import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every page a project's pages link or redirect to is inside the project:
// there is no /checklists or /sources/new outside one, so a link without the
// /p/{project} prefix is a link to a 404.
const ROOT = join(__dirname, "..", "..");
const SCANNED = ["src/app/p", "src/components"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Absolute app paths in href=... or redirect(...), as written in the source. */
export function appPaths(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:href=\{?|redirect\()\s*[`"']((?:\$\{basePath\})?\/[^`"']*)/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

const inProject = (path: string) => /^(?:\$\{basePath\})?\/p\/\$\{/.test(path);

describe("links inside a project", () => {
  it("recognises a link that leaves the project", () => {
    expect(appPaths('<Link href="/sources/new">').filter((p) => !inProject(p))).toEqual(["/sources/new"]);
    expect(appPaths("redirect(`/checklists`);").filter((p) => !inProject(p))).toEqual(["/checklists"]);
    expect(appPaths("href={`${basePath}/submissions/${id}/report`}").filter((p) => !inProject(p))).toHaveLength(1);
    expect(appPaths("href={`${basePath}/p/${project}/submissions/${id}/report`}").filter((p) => !inProject(p))).toEqual([]);
  });

  it("all stay inside it", () => {
    const leaving = SCANNED.flatMap((dir) =>
      files(join(ROOT, dir)).flatMap((file) =>
        appPaths(readFileSync(file, "utf8"))
          .filter((p) => !inProject(p))
          .map((p) => `${relative(ROOT, file)}: ${p}`),
      ),
    );
    expect(leaving).toEqual([]);
  });
});
