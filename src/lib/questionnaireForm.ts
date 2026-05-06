// Shared helpers for the ingest + review server actions.
// Centralises FormData parsing and validation so the two paths stay in sync.

import { z } from "zod";
import {
  countries as countryList,
  regulations as regulationList,
} from "@/data";

export const metaSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  sourceId: z.string().trim().min(1, "Source / authority is required"),
  controlTopic: z.string().trim().min(1, "Control topic is required"),
  description: z.string().trim().optional(),
  sourceUpdatedAt: z
    .string()
    .trim()
    .optional()
    .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Invalid date"),
});

export type ParsedMeta = z.infer<typeof metaSchema>;

export type FieldErrors = Partial<
  Record<
    | "title"
    | "sourceId"
    | "controlTopic"
    | "description"
    | "sourceUpdatedAt"
    | "countryIds"
    | "regulationIds"
    | "questions"
    | "file",
    string
  >
>;

export type ActionState =
  | { error?: string; fieldErrors?: FieldErrors }
  | undefined;

export function parseMeta(formData: FormData):
  | { ok: true; data: ParsedMeta }
  | { ok: false; fieldErrors: FieldErrors } {
  const result = metaSchema.safeParse({
    title: formData.get("title"),
    sourceId: formData.get("sourceId"),
    controlTopic: formData.get("controlTopic"),
    description: formData.get("description") ?? undefined,
    sourceUpdatedAt: formData.get("sourceUpdatedAt") ?? undefined,
  });
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fieldErrors)) {
      (fieldErrors as Record<string, string>)[key] = issue.message;
    }
  }
  return { ok: false, fieldErrors };
}

export function parseTags(formData: FormData):
  | { ok: true; countryIds: string[]; regulationIds: string[] }
  | { ok: false; fieldErrors: FieldErrors } {
  const countryIds = formData
    .getAll("countryIds")
    .map((v) => (typeof v === "string" ? v : ""))
    .filter(Boolean);
  const regulationIds = formData
    .getAll("regulationIds")
    .map((v) => (typeof v === "string" ? v : ""))
    .filter(Boolean);

  const fieldErrors: FieldErrors = {};
  if (countryIds.length === 0)
    fieldErrors.countryIds = "Pick at least one country of origin.";
  if (regulationIds.length === 0)
    fieldErrors.regulationIds = "Pick at least one regulation or standard.";

  if (!fieldErrors.countryIds) {
    const unknown = countryIds.find((c) => !countryList.some((x) => x.id === c));
    if (unknown) fieldErrors.countryIds = `Unknown country: ${unknown}`;
  }
  if (!fieldErrors.regulationIds) {
    const unknown = regulationIds.find(
      (r) => !regulationList.some((x) => x.id === r),
    );
    if (unknown) fieldErrors.regulationIds = `Unknown regulation: ${unknown}`;
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, countryIds, regulationIds };
}

export type ParsedQuestion = {
  text: string;
  article: string | null;
  category: string | null;
};

// Reads indexed form fields named `q.<idx>.{text|article|category}`,
// trims, drops empty rows, and returns them in index order.
export function parseQuestions(formData: FormData): ParsedQuestion[] {
  const map = new Map<
    number,
    { text?: string; article?: string; category?: string }
  >();
  for (const [field, value] of formData.entries()) {
    const m = field.match(/^q\.(\d+)\.(text|article|category)$/);
    if (!m || typeof value !== "string") continue;
    const idx = parseInt(m[1], 10);
    const row = map.get(idx) ?? {};
    row[m[2] as "text" | "article" | "category"] = value;
    map.set(idx, row);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => ({
      text: (row.text ?? "").trim(),
      article: (row.article ?? "").trim() || null,
      category: (row.category ?? "").trim() || null,
    }))
    .filter((q) => q.text.length > 0);
}
