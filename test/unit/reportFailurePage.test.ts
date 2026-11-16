import { describe, it, expect, vi, afterEach } from "vitest";

// When the PDF cannot be made, the person gets a page that says so and leads back to the submission.
// What went wrong inside (the renderer's address, how to start it, the raw error, the renderer's own
// answer) is for the logs, not for the page.
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const RENDERER = "http://controls-pdf:8005";

const submission = {
  id: "s1",
  label: "Review",
  status: "Closed",
  version: 1,
  createdAt: new Date(2026, 8, 1),
  closedAt: null,
  checklist: { title: "T", controlTopic: "Transparency", countryIds: [], regulationIds: [], questions: [], source: { name: "S" } },
  answers: [],
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/projectDb", () => ({
  projectDbFor: vi.fn(async () => ({
    submission: { findUnique: vi.fn(async () => submission) },
    submissionAnswerFile: { findMany: vi.fn(async () => []) },
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function report(renderer: () => Promise<Response>): Promise<Response> {
  vi.stubEnv("PDF_RENDERER_URL", RENDERER);
  vi.stubGlobal("fetch", vi.fn(renderer));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { GET } = await import("@/app/p/[project]/submissions/[id]/report/route");
  return GET(new Request(`http://localhost/p/${P1}/submissions/s1/report`), {
    params: Promise.resolve({ project: P1, id: "s1" }),
  });
}

/** Whether the answer leads back to the submission: a redirect to it, or a page that links it. */
function leadsBack(res: Response, body: string): boolean {
  const back = `/p/${P1}/submissions/s1`;
  return (res.headers.get("location") ?? "").includes(back) || body.includes(`href="${back}`) || body.includes(back + '"');
}

describe("a PDF that cannot be made", () => {
  it("when the renderer cannot be reached, says so without its address, the start command or the raw error", async () => {
    const res = await report(async () => {
      throw new TypeError("fetch failed");
    });
    const body = await res.text();
    expect(body).not.toContain(RENDERER);
    expect(body).not.toMatch(/docker compose/);
    expect(body).not.toContain("fetch failed");
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/plain/);
  });

  it("when the renderer refuses, does not show its answer", async () => {
    const res = await report(async () =>
      new Response(JSON.stringify({ detail: "Traceback: jinja2 UndefinedError in document.html.j2" }), { status: 500 }));
    const body = await res.text();
    expect(body).not.toContain("Traceback");
    expect(body).not.toContain("document.html.j2");
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/plain/);
  });

  it("leads back to the submission", async () => {
    const res = await report(async () => {
      throw new TypeError("fetch failed");
    });
    const body = await res.text();
    expect(leadsBack(res, body), `the answer: ${res.status} '${body.slice(0, 120)}'`).toBe(true);
  });
});
