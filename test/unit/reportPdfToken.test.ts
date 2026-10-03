import { describe, it, expect, vi, afterEach } from "vitest";

// controls-pdf refuses a caller without a token (services/pdf_renderer/service_token.py). Its one
// caller is this route, which sends CONTROLS_WEB_TO_PDF_TOKEN in
// X-AISC-Service-Token, and a refusal is still reported as the renderer's 502.

const HEADER = "X-AISC-Service-Token";
// Split so no credential scanner reads it as a real one.
const TOKEN = ["controls", "web", "to", "pdf", "test", "value"].join("-");

const submission = {
  id: "s1",
  label: "Review",
  status: "Closed",
  version: 1,
  createdAt: new Date(2026, 8, 1),
  closedAt: null,
  checklist: {
    title: "T",
    controlTopic: "Transparency",
    countryIds: [],
    regulationIds: [],
    questions: [],
    source: { name: "S" },
  },
  answers: [],
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: vi.fn(async () => ({ submission: { findUnique: vi.fn(async () => submission) } })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function report(status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(status === 200 ? new Uint8Array([37, 80]) : "a service token is needed", { status }),
  );
  vi.stubGlobal("fetch", fetchImpl);
  const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
  const res = await GET(new Request("http://c/x"), {
    params: Promise.resolve({ project: "p1", id: "s1" }),
  });
  return { res, fetchImpl };
}

describe("the report route calls controls-pdf with its token", () => {
  it("sends CONTROLS_WEB_TO_PDF_TOKEN in X-AISC-Service-Token", async () => {
    vi.stubEnv("CONTROLS_WEB_TO_PDF_TOKEN", TOKEN);
    const { res, fetchImpl } = await report();
    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/render\/pdf$/);
    expect(init.headers[HEADER]).toBe(TOKEN);
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("sends no token header when none is set, and a refusal is a 502", async () => {
    vi.stubEnv("CONTROLS_WEB_TO_PDF_TOKEN", "");
    const { res, fetchImpl } = await report(401);
    expect(fetchImpl.mock.calls[0][1].headers[HEADER]).toBeUndefined();
    expect(res.status).toBe(502);
  });
});
