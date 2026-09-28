import { describe, it, expect, vi } from "vitest";
import { fetchCatalogueControls } from "@/lib/catalogueControls";

const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const entry = (over: Record<string, unknown>) => ({
  slug: "s",
  name: "S",
  description: "d",
  status: "approved",
  storage_path: "/controls/s",
  ...over,
});

describe("fetchCatalogueControls", () => {
  it("asks the catalogue's list, anonymously when no token is set", async () => {
    const fetchImpl = ok([]);
    await fetchCatalogueControls({ baseUrl: "https://catalogue.example/api/", token: "", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://catalogue.example/api/tool/");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("keeps only approved controls, not tools, sorted by name", async () => {
    const fetchImpl = ok([
      entry({ slug: "zeta", name: "Zeta checklist", storage_path: "/controls/zeta" }),
      entry({ slug: "langbite", name: "LangBiTe", storage_path: "/packages/langbite", package_name: "aisc-plugin-langbite" }),
      entry({ slug: "draft", name: "Draft", status: "pending", storage_path: "/controls/draft" }),
      entry({ slug: "alpha", name: "alpha checklist", description: null, storage_path: "/controls/alpha" }),
      entry({ slug: "nopath", name: "No path", storage_path: null }),
    ]);
    const got = await fetchCatalogueControls({ baseUrl: "http://cat", fetchImpl });
    expect(got).toEqual({
      ok: true,
      controls: [
        { slug: "alpha", name: "alpha checklist", description: null },
        { slug: "zeta", name: "Zeta checklist", description: "d" },
      ],
    });
  });

  it("says so when the catalogue cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const got = await fetchCatalogueControls({ baseUrl: "http://cat", fetchImpl });
    expect(got).toEqual({ ok: false, reason: "The catalogue is not answering, so its checklists cannot be listed." });
  });

  it("says so when the catalogue answers with an error", async () => {
    const got = await fetchCatalogueControls({ baseUrl: "http://cat", fetchImpl: ok({ detail: "x" }, 500) });
    expect(got).toEqual({ ok: false, reason: "The catalogue is not answering, so its checklists cannot be listed." });
  });

  it("says so when the catalogue sends something that is not a list", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Sign in</html>", { status: 200 }));
    const got = await fetchCatalogueControls({ baseUrl: "http://cat", fetchImpl });
    expect(got).toEqual({ ok: false, reason: "The catalogue sent something that is not a list of checklists." });
    expect((await fetchCatalogueControls({ baseUrl: "http://cat", fetchImpl: ok({ items: [] }) })).ok).toBe(false);
  });

  it("says so when it does not know where the catalogue is", async () => {
    const fetchImpl = vi.fn();
    const got = await fetchCatalogueControls({ baseUrl: "", fetchImpl });
    expect(got).toEqual({ ok: false, reason: "This install does not know where the catalogue is." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the bridge token when there is one", async () => {
    const fetchImpl = ok([]);
    await fetchCatalogueControls({ baseUrl: "http://cat", token: "t0k", fetchImpl });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer t0k" } });
  });
});
