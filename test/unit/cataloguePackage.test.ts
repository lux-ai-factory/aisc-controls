import { describe, it, expect, vi } from "vitest";
import { fetchCataloguePackage } from "@/lib/cataloguePackage";

const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("fetchCataloguePackage", () => {
  it("asks a public catalogue anonymously when no token is set", async () => {
    const fetchImpl = ok({ meta: { catalogueId: "c" }, questions: [] });
    await fetchCataloguePackage("c", { baseUrl: "https://catalogue.example/api", token: "", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://catalogue.example/api/control/c/export");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("asks the catalogue for the control's package", async () => {
    const fetchImpl = ok({ meta: { catalogueId: "accuracy-checklist" }, questions: [] });
    const got = await fetchCataloguePackage("accuracy-checklist", { baseUrl: "http://cat:8000/", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("http://cat:8000/control/accuracy-checklist/export", expect.anything());
    expect(got).toEqual({ ok: true, pkg: { meta: { catalogueId: "accuracy-checklist" }, questions: [] } });
  });

  it("says so when the catalogue has no such control", async () => {
    const got = await fetchCataloguePackage("nope", { baseUrl: "http://cat:8000", fetchImpl: ok({ detail: "x" }, 404) });
    expect(got).toEqual({ ok: false, reason: "The catalogue has no control called “nope”." });
  });

  it("says so when the catalogue answers 200 with something that is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const got = await fetchCataloguePackage("x", { baseUrl: "http://cat:8000", fetchImpl });
    expect(got).toEqual({ ok: false, reason: "The catalogue sent something that is not a control package. Nothing was installed." });
  });

  it("says so when the catalogue cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const got = await fetchCataloguePackage("x", { baseUrl: "http://cat:8000", fetchImpl });
    expect(got).toEqual({ ok: false, reason: "The catalogue is not answering. Nothing was installed." });
  });

  it("sends the bridge token when there is one, and nothing when there is not", async () => {
    const fetchImpl = ok({ meta: {}, questions: [] });
    await fetchCataloguePackage("x", { baseUrl: "https://catalogue.example", token: "t0k", fetchImpl });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer t0k" } });
    await fetchCataloguePackage("x", { baseUrl: "https://catalogue.example", token: "", fetchImpl });
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ headers: {} });
  });

  it("says the catalogue refused this platform when the token is wrong", async () => {
    const got = await fetchCataloguePackage("x", { baseUrl: "https://catalogue.example", token: "bad", fetchImpl: ok({}, 401) });
    expect(got).toEqual({ ok: false, reason: "The catalogue refused this platform: check CATALOGUE_TOKEN. Nothing was installed." });
  });

  it.each(["", "../admin", "a b", "x/y"])("refuses the slug %j without asking", async (slug) => {
    const fetchImpl = vi.fn();
    expect((await fetchCataloguePackage(slug, { baseUrl: "http://cat:8000", fetchImpl })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
