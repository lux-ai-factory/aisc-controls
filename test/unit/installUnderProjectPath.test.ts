import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// An install is a change to one project, and the ledger accepts a project's event only from a request to
// that project's own address (/controls/p/<project>/...): there the gateway's witness binds the request
// to the project. So both ways to install a checklist (the catalogue's dialog, and the install page it
// falls back to) post under the project's address, and an install whose form names another project than
// its address is refused.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const P2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const CATALOGUE = "http://localhost:8102";

const APP = fileURLToPath(new URL("../../src/app/", import.meta.url));
const PROJECT_INSTALL_API = `${APP}p/[project]/api/install/route.ts`;
const PROJECT_INSTALL_PAGE = `${APP}p/[project]/install/page.tsx`;

const h = vi.hoisted(() => ({ installs: [] as string[] }));

vi.mock("@/lib/access/callerToken", () => ({ callerToken: async () => "token" }));
vi.mock("@/lib/cataloguePackage", () => ({
  fetchCataloguePackage: async () => ({
    ok: true,
    pkg: { meta: { catalogueId: "fraia", title: "FRAIA", sourceName: "S", controlTopic: "Rights" }, questions: [{ text: "q" }] },
  }),
}));
vi.mock("@/lib/projectDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectDb")>()),
  writableProject: async (pid: string) => ({ prisma: { pid } }),
}));
vi.mock("@/lib/installChecklist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/installChecklist")>()),
  installChecklist: async (prisma: { pid: string }) => {
    h.installs.push(prisma.pid);
    return { checklistId: "chk_new", created: true };
  },
}));

beforeEach(() => {
  process.env.CATALOGUE_ORIGIN = CATALOGUE;
  h.installs = [];
});

describe("installing a checklist goes through the project's own address", () => {
  it("the catalogue's install API is served under the project", () => {
    expect(existsSync(PROJECT_INSTALL_API), `no install API under /p/<project>: ${PROJECT_INSTALL_API}`).toBe(true);
  });

  it("the install page's form is served under the project", () => {
    expect(existsSync(PROJECT_INSTALL_PAGE), `no install page under /p/<project>: ${PROJECT_INSTALL_PAGE}`).toBe(true);
  });

  it("an install whose form names another project than its address is refused, and nothing is installed", async () => {
    expect(existsSync(PROJECT_INSTALL_API), "no install API under /p/<project>").toBe(true);
    const route = (await import(/* @vite-ignore */ PROJECT_INSTALL_API)) as {
      POST: (req: Request, ctx: { params: Promise<{ project: string }> }) => Promise<Response>;
    };
    const res = await route.POST(
      new Request(`http://localhost/controls/p/${P1}/api/install`, {
        method: "POST",
        headers: { origin: CATALOGUE },
        body: new URLSearchParams({ slug: "fraia", project: P2 }),
      }),
      { params: Promise.resolve({ project: P1 }) },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.installs).toEqual([]);
  });
});
