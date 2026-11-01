import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Proof files, in the parts that need no database: the platform client, the helpers the routes use, the
// list each question shows, the ledger state that ignores an answer row holding only files, and the
// request size the app lets through to its upload route.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { readProofFile, storeProofFile } from "@/lib/proofStore";
import { attachmentHeader, formatSize, MAX_FILES_PER_QUESTION, refuseCrossSite } from "@/lib/proofFiles";
import { nameFromClaims, claimsOf } from "@/lib/access/callerName";
import { submissionState } from "@/lib/ledger/state";
import ProofFiles from "@/app/p/[project]/submissions/[id]/ProofFiles";

const P1 = "3f2b8c1e-0d4a-4e7b-9a55-1c2d3e4f5a6b";
const STORED = { id: "5b7f0b1e-1d7e-4c7a-9a43-0c1f5d0b9e11", name: "policy.pdf", mime: "application/pdf", size: 2048,
                 sha256: "a".repeat(64) };

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("the platform client", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_URL", "http://platform:8000/");
    vi.stubEnv("PLATFORM_CONTROLS_TOKEN", "controls-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends the bytes with the name and this app's token, and keeps what the platform stored", async () => {
    const calls: Call[] = [];
    const answer = await storeProofFile(P1, "my policy.pdf", new Uint8Array([1, 2]), fakeFetch(201, STORED, calls));
    expect(answer).toEqual({ ok: true, file: STORED });
    expect(calls[0].url).toBe(`http://platform:8000/internal/projects/${P1}/proof-files?name=my%20policy.pdf`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["X-AISC-Service-Token"]).toBe("controls-token");
  });

  it.each([413, 415, 422])("passes the platform's refusal %i on with its reason", async (status) => {
    const answer = await storeProofFile(P1, "x.pdf", new Uint8Array([1]), fakeFetch(status, { detail: "why" }));
    expect(answer).toEqual({ ok: false, status, error: "why" });
  });

  it("anything else, or no answer, is 503 without the platform's words", async () => {
    expect(await storeProofFile(P1, "x.pdf", new Uint8Array([1]), fakeFetch(401, { detail: "a service token is needed" })))
      .toMatchObject({ ok: false, status: 503 });
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await storeProofFile(P1, "x.pdf", new Uint8Array([1]), down)).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv("PLATFORM_URL", "");
    expect(await storeProofFile(P1, "x.pdf", new Uint8Array([1]), fakeFetch(201, STORED))).toMatchObject({ status: 503 });
  });

  it("reads a file back with the token; a file the platform does not have is null", async () => {
    const calls: Call[] = [];
    const found = await readProofFile(P1, STORED.id, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("bytes", { status: 200 });
    }) as unknown as typeof fetch);
    expect(await found?.text()).toBe("bytes");
    expect(calls[0].url).toBe(`http://platform:8000/internal/projects/${P1}/proof-files/${STORED.id}`);
    expect((calls[0].init.headers as Record<string, string>)["X-AISC-Service-Token"]).toBe("controls-token");
    expect(await readProofFile(P1, STORED.id, fakeFetch(404, { detail: "no" }))).toBeNull();
    await expect(readProofFile(P1, STORED.id, fakeFetch(503, { detail: "down" }))).rejects.toThrow();
  });
});

describe("the helpers", () => {
  it("a download names the file, with an ASCII fallback", () => {
    expect(attachmentHeader("policy.pdf")).toBe(`attachment; filename="policy.pdf"; filename*=UTF-8''policy.pdf`);
    expect(attachmentHeader('Évaluation "v2".pdf'))
      .toBe(`attachment; filename="_valuation _v2_.pdf"; filename*=UTF-8''%C3%89valuation%20%22v2%22.pdf`);
  });

  it("sizes read as people read them", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(3500)).toBe("3.4 KB");
    expect(formatSize(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("a question takes at most 10 files", () => {
    expect(MAX_FILES_PER_QUESTION).toBe(10);
  });

  it("only this app's own fetches may attach or remove", () => {
    const req = (headers: Record<string, string>) => new Request("https://c.test/x", { method: "POST", headers });
    expect(refuseCrossSite(req({ "x-requested-with": "aisc-controls", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(refuseCrossSite(req({ "x-requested-with": "aisc-controls" }))).toBeNull();      // an older browser
    expect(refuseCrossSite(req({ "x-requested-with": "aisc-controls", "sec-fetch-site": "same-site" }))?.status).toBe(403);
    expect(refuseCrossSite(req({ "sec-fetch-site": "same-origin" }))?.status).toBe(403);
  });

  it("who uploaded is the token's email, else its user name, else its subject", async () => {
    expect(nameFromClaims({ email: "a@x.org", preferred_username: "a", sub: "s" })).toBe("a@x.org");
    expect(nameFromClaims({ preferred_username: "alice", sub: "s" })).toBe("alice");
    expect(nameFromClaims({ sub: "s-1" })).toBe("s-1");
    expect(nameFromClaims(null)).toBeNull();
    vi.stubEnv("AUTH_ENABLED", "false");
    const unsigned = ["e30", Buffer.from(JSON.stringify({ email: "b@x.org" })).toString("base64url"), "sig"].join(".");
    expect(nameFromClaims(await claimsOf(unsigned))).toBe("b@x.org");
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("KEYCLOAK_ISSUER", "http://keycloak/realms/aisc");
    expect(await claimsOf(unsigned, { keyFor: async () => { throw new Error("no key"); } })).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("the ledger state of a submission", () => {
  it("leaves out an answer row that only holds proof files", () => {
    const state = submissionState("Run", "Draft", [
      { questionId: "q2", answer: null, score: null },
      { questionId: "q1", answer: "yes", score: null },
      { questionId: "q3", answer: null, score: 0 },
    ]);
    expect(state.answers).toEqual([
      { questionId: "q1", answer: "yes", score: null },
      { questionId: "q3", answer: null, score: 0 },
    ]);
  });
});

describe("a question's files", () => {
  const files = [{ ...STORED, uploadedBy: "alice@example.org", uploadedAt: "2026-11-01T09:30:00.000Z" }];
  const render = (props: Partial<Parameters<typeof ProofFiles>[0]>) =>
    renderToStaticMarkup(createElement(ProofFiles, {
      basePath: "/controls", project: P1, submissionId: "sub1", questionId: "q1", files, editable: true, ...props,
    }));

  it("lists each file with its size, who attached it and when, and a download link", () => {
    const html = render({});
    expect(html).toContain("policy.pdf");
    expect(html).toContain("2.0 KB");
    expect(html).toContain("alice@example.org");
    expect(html).toContain(`href="/controls/p/${P1}/submissions/sub1/questions/q1/files/${STORED.id}"`);
    expect(html).toContain("download");
  });

  it("a draft can attach and remove", () => {
    const html = render({});
    expect(html).toContain("Attach file");
    expect(html).toContain("Remove");
  });

  it("a closed submission only downloads", () => {
    const html = render({ editable: false });
    expect(html).not.toContain("Attach file");
    expect(html).not.toContain("Remove");
    expect(html).toContain("policy.pdf");
  });

  it("a full question offers no Attach", () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ ...files[0], id: `${i}`, name: `f${i}.pdf` }));
    expect(render({ files: full })).not.toContain("Attach file");
  });

  it("a closed question with no files shows nothing", () => {
    expect(render({ files: [], editable: false })).toBe("");
  });
});

describe("the request size", () => {
  it("lets a 25 MB file through the middleware to the upload route", async () => {
    const config = (await import("../../next.config")).default as { experimental?: { middlewareClientMaxBodySize?: string } };
    const limit = config.experimental?.middlewareClientMaxBodySize ?? "10mb";
    expect(Number.parseInt(limit, 10)).toBeGreaterThanOrEqual(26);
    expect(limit.endsWith("mb")).toBe(true);
  });
});
