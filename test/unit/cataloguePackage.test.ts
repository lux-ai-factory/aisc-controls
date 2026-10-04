import { describe, it, expect, vi } from "vitest";
import { fetchCataloguePackage } from "@/lib/cataloguePackage";

// A control's package comes from the platform, for one project: the platform knows which catalogue the
// project chose (public or its private copy) and answers from it (plan 2026-10-04 P2).
const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const PLATFORM = "http://platform:8000";

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const opts = (fetchImpl: ReturnType<typeof vi.fn>, token: string | null = "caller-token") =>
  ({ platformUrl: PLATFORM + "/", token, fetchImpl: fetchImpl as unknown as typeof fetch });

describe("fetchCataloguePackage", () => {
  it("asks the platform for the project's control, with the caller's token", async () => {
    const fetchImpl = answer({ meta: { catalogueId: "accuracy-checklist" }, questions: [] });
    const got = await fetchCataloguePackage(P1, "accuracy-checklist", opts(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PLATFORM}/projects/${P1}/catalogue/control/accuracy-checklist/export`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer caller-token" });
    expect(got).toEqual({ ok: true, pkg: { meta: { catalogueId: "accuracy-checklist" }, questions: [] } });
  });

  it("asks for a slug with a run of hyphens, as the catalogue names four of its controls", async () => {
    const slug = "data-and-data-governance-evaluation-tool---article-10-ai-act";
    const fetchImpl = answer({ meta: { catalogueId: slug }, questions: [] });
    expect((await fetchCataloguePackage(P1, slug, opts(fetchImpl))).ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${PLATFORM}/projects/${P1}/catalogue/control/${slug}/export`);
  });

  it("says the project's catalogue has no such control on a 404", async () => {
    const got = await fetchCataloguePackage(P1, "nope", opts(answer({ detail: "x" }, 404)));
    expect(got).toEqual({ ok: false, status: 404, reason: "This project's catalogue has no control called “nope”." });
  });

  it("passes on the platform's reason when the project has not chosen its catalogue", async () => {
    const detail = "this project has not chosen its catalogue yet: open it from the project page";
    const got = await fetchCataloguePackage(P1, "x", opts(answer({ detail }, 409)));
    expect(got).toEqual({ ok: false, status: 409, reason: `${detail}. Nothing was installed.` });
  });

  it("says the platform refused when the sign-in is not accepted", async () => {
    for (const status of [401, 403]) {
      const got = await fetchCataloguePackage(P1, "x", opts(answer({}, status)));
      expect(got).toEqual({ ok: false, status: 403, reason: "The platform refused to give this control: sign in again. Nothing was installed." });
    }
  });

  it("says the catalogue is not answering on a 503, or when the platform cannot be reached", async () => {
    const down = await fetchCataloguePackage(P1, "x", opts(answer({ detail: "the public catalogue did not answer" }, 503)));
    expect(down).toEqual({ ok: false, status: 502, reason: "The catalogue is not answering. Nothing was installed." });
    const unreachable = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await fetchCataloguePackage(P1, "x", opts(unreachable))).toEqual(down);
  });

  it("says so when the answer is a 200 that is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const got = await fetchCataloguePackage(P1, "x", opts(fetchImpl));
    expect(got).toEqual({ ok: false, status: 502, reason: "The catalogue sent something that is not a control package. Nothing was installed." });
  });

  it("says this install does not know where the platform is", async () => {
    const fetchImpl = vi.fn();
    const got = await fetchCataloguePackage(P1, "x", { platformUrl: "", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(got).toEqual({ ok: false, status: 502, reason: "This install does not know where the platform is." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["", "../admin", "a b", "x/y", "-lead", "trail-", "a..b"])("refuses the slug %j without asking", async (slug) => {
    const fetchImpl = vi.fn();
    expect(await fetchCataloguePackage(P1, slug, opts(fetchImpl))).toMatchObject({ ok: false, status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["", "abc", "../x"])("refuses the project %j without asking", async (project) => {
    const fetchImpl = vi.fn();
    expect(await fetchCataloguePackage(project, "x", opts(fetchImpl))).toEqual({ ok: false, status: 400, reason: "Choose a project." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
