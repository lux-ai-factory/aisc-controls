// Pulls compliance questions out of arbitrary document text.
// All LLM traffic goes through LLMFactory — the provider (Anthropic, OpenAI,
// local model, …) and its credentials live in the LLMFactory deployment, not
// here.

import { executePrompt } from "./llmFactory";

export type ExtractedQuestion = {
  text: string;
  article: string | null;
  category: string | null;
};

const SYSTEM_PROMPT = `You are an expert in compliance and control questionnaires. You receive the raw text of a document (extracted from .docx, .xlsx, .csv, .txt, .md, or similar) that contains compliance / control questions, issued by any kind of authority, standards body, or organisation.

Your job is to identify every distinct question or check that an evaluator would need to answer, and return them as structured JSON.

Rules:
- Extract questions verbatim where possible. Light cleanup of whitespace and bullet artefacts is fine, but do not rewrite the meaning.
- Skip pure prose, headings, definitions, or descriptive paragraphs. Keep only items that ask the reader to evaluate / confirm / describe / provide something.
- If a question references an article, clause, section, or paragraph (e.g. "Article 10.2.b", "§4.3", "Clause 7.1.2", "Annex IV.1.a"), capture it in the "article" field.
- If the document groups questions under a category / domain / theme heading (e.g. "Data Governance", "Human Oversight"), capture the immediate category in the "category" field.
- Preserve the original order.
- Do NOT invent questions. If the document has no questions, return an empty list.

Respond ONLY with a JSON object — no prose, no markdown fences — matching this schema:

{
  "questions": [
    { "text": "...", "article": "Article 10.2.b" | null, "category": "Data Governance" | null }
  ]
}`;

export async function extractQuestionsFromText(
  documentText: string,
  context: { sourceName: string; controlTopic: string; regulationNames: string[] },
): Promise<ExtractedQuestion[]> {
  const model = process.env.LLM_MODEL;
  if (!model) {
    throw new Error("LLM_MODEL is not configured on the server.");
  }

  const userPrompt = [
    `Source: ${context.sourceName}`,
    `Control topic: ${context.controlTopic}`,
    context.regulationNames.length
      ? `Related regulations / standards: ${context.regulationNames.join(", ")}`
      : null,
    "",
    "Document text:",
    "----- BEGIN DOCUMENT -----",
    documentText,
    "----- END DOCUMENT -----",
    "",
    "Now return the JSON object.",
  ]
    .filter(Boolean)
    .join("\n");

  // LLMFactory's /execute_prompt takes a single `prompt` field with no
  // system/user split, so we concatenate.
  const combined = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
  const raw = (await executePrompt(model, combined)).trim();

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new Error("Model did not return a JSON object.");
  }

  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
    questions?: Array<{
      text?: string;
      article?: string | null;
      category?: string | null;
    }>;
  };

  if (!Array.isArray(parsed.questions)) {
    throw new Error("Model output missing 'questions' array.");
  }

  return parsed.questions
    .filter((q) => typeof q.text === "string" && q.text.trim().length > 0)
    .map((q) => ({
      text: q.text!.trim(),
      article: q.article?.trim() || null,
      category: q.category?.trim() || null,
    }));
}
