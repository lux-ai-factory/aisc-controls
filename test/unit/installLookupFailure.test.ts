import { describe, it, expect, vi, afterEach } from "vitest";

import { lookupInstalledChecklist } from "@/lib/projectDb";

// A look-up that failed for any reason used to be shown as "not installed", with no trace. A project
// database that is not there, or not migrated yet, is "not installed" and is expected; any other failure
// (the cluster refusing the connection, too many clients) is still "not known to have it", but logged,
// without the database URL (it holds the password).
afterEach(() => vi.restoreAllMocks());

describe("a look-up that fails for another reason than a missing database", () => {
  it("is logged, without the URL, and still answers null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = "postgresql://controls_rw:s3cret@127.0.0.1:1/project_x?schema=controls";
    expect(await lookupInstalledChecklist(url, "accuracy-checklist")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("s3cret");
  });
});
