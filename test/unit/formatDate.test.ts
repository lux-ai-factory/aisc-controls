import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "@/lib/formatDate";

// Built from local-time components, so these assertions are time-zone agnostic
// (the formatters read getDate/getMonth/... which are local).
describe("formatDate", () => {
  it("formats as dd/mm/yyyy with zero-padding", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("05/01/2026");
    expect(formatDate(new Date(2026, 11, 31))).toBe("31/12/2026");
  });
});

describe("formatDateTime", () => {
  it("appends zero-padded HH:MM", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7))).toBe("05/01/2026 09:07");
  });
});
