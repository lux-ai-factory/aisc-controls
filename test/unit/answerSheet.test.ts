import { describe, it, expect } from "vitest";

import { answerSheet } from "@/lib/answerSheet";

// What a submission's page and report show. A draft follows the template; a closed submission shows each
// question it answered as it was when it was closed, whatever the template says now.
const live = [
  { id: "q1", order: 1, text: "A, reworded?", article: "Art. 10", category: "New" },
  { id: "q3", order: 2, text: "C?", article: null, category: null },
];
const answer = (over: Partial<Parameters<typeof answerSheet>[2][number]>) => ({
  id: "a", questionId: "q1", answer: "yes", score: 4, systemVersionNumber: 2,
  questionText: null, questionArticle: null, questionCategory: null, questionOrder: null, ...over,
});

describe("a draft's sheet", () => {
  it("is today's questions, with its answers", () => {
    const sheet = answerSheet("Draft", live, [answer({})]);
    expect(sheet.questions.map((q) => q.text)).toEqual(["A, reworded?", "C?"]);
    expect(sheet.answersByQ).toEqual({ q1: "yes" });
    expect(sheet.scoresByQ).toEqual({ q1: 4 });
    expect(sheet.versionByQ).toEqual({ q1: 2 });
  });
});

describe("a closed submission's sheet", () => {
  const closed = [
    answer({ id: "a1", questionText: "A?", questionArticle: "Art. 9", questionCategory: "Old", questionOrder: 1 }),
    // its question was removed from the template since
    answer({ id: "a2", questionId: null, answer: "no", score: null, systemVersionNumber: null,
             questionText: "B?", questionOrder: 2 }),
  ];

  it("shows each answered question with the wording it was answered under", () => {
    const sheet = answerSheet("Closed", live, closed);
    expect(sheet.questions[0]).toMatchObject({ text: "A?", article: "Art. 9", category: "Old" });
    expect(sheet.answersByQ[sheet.questions[0].id]).toBe("yes");
  });

  it("keeps an answer to a removed question, in its place", () => {
    const sheet = answerSheet("Closed", live, closed);
    expect(sheet.questions.map((q) => q.text)).toEqual(["A?", "B?", "C?"]);
    const removed = sheet.questions[1].id;
    expect(sheet.answersByQ[removed]).toBe("no");
    expect(sheet.versionByQ[removed]).toBeNull();
  });

  it("lists the template's questions it left unanswered, without an answer", () => {
    const sheet = answerSheet("Closed", live, closed);
    expect(sheet.questions[2]).toMatchObject({ id: "q3", text: "C?" });
    expect("q3" in sheet.answersByQ).toBe(false);
    expect("q3" in sheet.versionByQ).toBe(false);
  });

  it("falls back on today's wording for an answer that kept none", () => {
    const sheet = answerSheet("Closed", live, [answer({})]);
    expect(sheet.questions[0]).toMatchObject({ id: "q1", text: "A, reworded?" });
  });
});
