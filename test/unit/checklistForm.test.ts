import { describe, it, expect } from "vitest";
import {
  parseMeta,
  parseTags,
  parseQuestions,
  parseAnswers,
} from "@/lib/checklistForm";

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.set(key, value);
  }
  return fd;
}

describe("parseMeta", () => {
  it("accepts valid metadata", () => {
    const result = parseMeta(
      form({ title: "T", sourceId: "s1", controlTopic: "Topic" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.title).toBe("T");
  });

  it("reports a field error for a missing title", () => {
    const result = parseMeta(form({ title: "", sourceId: "s1", controlTopic: "x" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.title).toBeTruthy();
  });

  it("rejects an invalid sourceUpdatedAt", () => {
    const result = parseMeta(
      form({ title: "T", sourceId: "s1", controlTopic: "x", sourceUpdatedAt: "nope" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.sourceUpdatedAt).toBeTruthy();
  });
});

describe("parseTags", () => {
  it("requires at least one country and regulation", () => {
    const result = parseTags(form({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.countryIds).toBeTruthy();
      expect(result.fieldErrors.regulationIds).toBeTruthy();
    }
  });

  it("rejects unknown ids", () => {
    const result = parseTags(
      form({ countryIds: ["NOPE"], regulationIds: ["ai-act"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.countryIds).toContain("NOPE");
  });

  it("accepts known ids", () => {
    const result = parseTags(
      form({ countryIds: ["EU", "AT"], regulationIds: ["ai-act"] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.countryIds).toEqual(["EU", "AT"]);
      expect(result.regulationIds).toEqual(["ai-act"]);
    }
  });
});

describe("parseQuestions", () => {
  it("reads indexed rows in order and drops empty ones", () => {
    const questions = parseQuestions(
      form({
        "q.1.text": "Second",
        "q.0.text": "First",
        "q.0.article": "Art. 1",
        "q.2.text": "   ", // blank → dropped
      }),
    );
    expect(questions.map((q) => q.text)).toEqual(["First", "Second"]);
    expect(questions[0].article).toBe("Art. 1");
    expect(questions[1].article).toBeNull();
  });
});

describe("parseAnswers", () => {
  const validIds = new Set(["q1", "q2"]);

  it("pairs answer text with scores and skips unknown ids", () => {
    const answers = parseAnswers(
      form({
        "a:q1": "Yes, documented.",
        "s:q1": "4",
        "s:q2": "2",
        "a:ghost": "ignored", // not in validIds
      }),
      validIds,
    );
    const byId = Object.fromEntries(answers.map((a) => [a.questionId, a]));
    expect(byId.q1).toEqual({ questionId: "q1", answer: "Yes, documented.", score: 4 });
    expect(byId.q2).toEqual({ questionId: "q2", answer: null, score: 2 });
    expect(byId.ghost).toBeUndefined();
  });

  it("drops rows with neither an answer nor a score", () => {
    const answers = parseAnswers(
      form({ "a:q1": "   ", "s:q1": "" }),
      validIds,
    );
    expect(answers).toEqual([]);
  });
});
