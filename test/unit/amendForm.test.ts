import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The amend box on a final submission asks nothing: one button makes the next version.
vi.mock("react", async (orig) => {
  const react = await orig<typeof import("react")>();
  return { ...react, useActionState: () => [undefined, () => {}, false] };
});

import { AmendForm } from "@/app/p/[project]/submissions/[id]/SubmissionActions";

describe("the amend box", () => {
  it("has the Make version button and no question", () => {
    const html = renderToStaticMarkup(createElement(AmendForm, { action: async () => undefined, nextVersion: 2 }));
    expect(html).toContain("Make version 2");
    expect(html).not.toContain("Why are the answers amended?");
    expect(html).not.toContain("Who asked for it?");
    expect(html).not.toMatch(/<(textarea|input)\b/);
  });
});
