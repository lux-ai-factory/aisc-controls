import { describe, it, expect } from "vitest";
import { latestVersion } from "@/lib/systemVersion";

// latestVersion(tx) in src/lib/systemVersion.ts reads the project's latest saved card version in the
// save's own transaction: first a shared lock on the key the platform takes to make or correct a
// version, then the version from project.saved_system. The platform is never asked over the network.
// test/integration/answer-stamp-from-the-card.test.ts holds it to a real project database.

const V2 = "9b0e0d4c-2f1a-4c8e-8a3b-6d5e4f3a2b1c";

function fakeTx(latest: { pid: string; number: number } | null) {
  const asked: string[] = [];
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      asked.push(sql);
      if (/pg_advisory_xact_lock_shared/.test(sql)) return [{ locked: 1 }];
      return latest ? [latest] : [];
    },
  };
  return { tx: tx as never, asked };
}

describe("latestVersion", () => {
  it("takes the shared lock on the versions before it reads the latest one", async () => {
    const { tx, asked } = fakeTx({ pid: V2, number: 2 });
    expect(await latestVersion(tx)).toEqual({ pid: V2, number: 2 });
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/pg_advisory_xact_lock_shared\(hashtext\('project\.system'\)\)/);
    expect(asked[1]).toMatch(/FROM project\.saved_system ORDER BY number DESC LIMIT 1/);
  });

  it("is null when the project has no card version yet", async () => {
    const { tx } = fakeTx(null);
    expect(await latestVersion(tx)).toBeNull();
  });
});
