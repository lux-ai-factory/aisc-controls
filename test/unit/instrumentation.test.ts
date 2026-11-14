// The app refuses to start when AUTH_ENABLED or LEDGER_MODE holds a value that is not a switch word: Next
// runs register() from src/instrumentation.ts once at start, in the Node runtime, before any request.
import { afterEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function instrumentation(): Promise<any> {
  const path = "@/instrumentation";
  try {
    return await import(/* @vite-ignore */ path);
  } catch (e) {
    expect.fail(`there is no start check (src/instrumentation.ts): ${String(e)}`);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the start check", () => {
  it("refuses to start on a bad switch", async () => {
    const { register } = await instrumentation();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("AUTH_ENABLED", "ture");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    await expect(register()).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses an empty ledger mode", async () => {
    const { register } = await instrumentation();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("LEDGER_MODE", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    await expect(register()).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts with valid switches", async () => {
    const { register } = await instrumentation();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("LEDGER_MODE", "record");
    await expect(register()).resolves.toBeUndefined();
  });
});
