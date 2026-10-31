import { describe, it, expect, vi, afterEach } from "vitest";

// The project database URL carries Prisma's own parameters (schema, connection_limit, pool_timeout),
// which pg does not know, and may carry connection options both understand, such as sslmode. The
// direct pg connections this app makes drop only Prisma's and keep the rest, and give up on a cluster
// that does not answer instead of waiting on it.
const h = vi.hoisted(() => ({ configs: [] as Array<{ connectionString?: string; connectionTimeoutMillis?: number }> }));

vi.mock("pg", () => {
  class Client {
    constructor(config: { connectionString?: string; connectionTimeoutMillis?: number }) {
      h.configs.push(config);
    }
    async connect() {}
    async query() {
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  }
  return { default: { Client } };
});

import { lookupInstalledChecklist } from "@/lib/projectDb";

afterEach(() => {
  h.configs = [];
});

describe("a direct connection to a project database", () => {
  it("keeps sslmode and drops Prisma's own parameters", async () => {
    const url = "postgresql://controls_rw:pw@db.example:5432/project_x?schema=controls&connection_limit=2&sslmode=require&pool_timeout=10";
    await lookupInstalledChecklist(url, "accuracy-checklist");
    expect(h.configs).toHaveLength(1);
    expect(h.configs[0].connectionString).toBe("postgresql://controls_rw:pw@db.example:5432/project_x?sslmode=require");
  });

  it("has nothing after the database when only Prisma's parameters were there", async () => {
    await lookupInstalledChecklist("postgresql://u:pw@h:5432/project_x?schema=controls&connection_limit=2", "c");
    expect(h.configs[0].connectionString).toBe("postgresql://u:pw@h:5432/project_x");
  });

  it("gives up connecting after a while instead of waiting on the cluster", async () => {
    await lookupInstalledChecklist("postgresql://u:pw@h:5432/project_x", "c");
    expect(h.configs[0].connectionTimeoutMillis).toBeGreaterThan(0);
  });
});
