// Best-effort plain-text extraction from common compliance-document formats.
// We pull whatever text we can and hand it to the model, which is robust to
// messy input. Each parser returns a single string with the original ordering
// preserved.

import mammoth from "mammoth";
import ExcelJS from "exceljs";

export type ParsedDocument = {
  text: string;
  format: "docx" | "xlsx" | "txt" | "csv";
  sheets?: string[];
};

const MAX_TEXT_LENGTH = 200_000; // ~50k tokens — enough for a long spreadsheet

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return (
    text.slice(0, MAX_TEXT_LENGTH) +
    `\n\n[truncated — original length ${text.length} chars]`
  );
}

// ExcelJS cell values can be primitives, Date, or several object shapes
// (rich text, hyperlinks, formulas, errors, merge refs). cell.text is a
// convenience getter but throws on merged-empty cells, so we walk cell.value.
function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => stringifyCell((p as { text?: string }).text)).join("");
    }
    if ("text" in obj) return stringifyCell(obj.text);
    if ("result" in obj) return stringifyCell(obj.result);
    if ("error" in obj) return String(obj.error);
  }
  return "";
}

export async function parseDocument(
  buffer: Buffer,
  filename: string,
): Promise<ParsedDocument> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: truncate(value), format: "docx" };
  }

  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    // exceljs's typings predate @types/node 22's generic Buffer<ArrayBufferLike>;
    // pass the underlying ArrayBuffer slice instead.
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheetTexts: string[] = [];
    const sheetNames: string[] = [];
    for (const sheet of workbook.worksheets) {
      sheetNames.push(sheet.name);
      const rows: string[] = [];
      // Render each sheet as a tab-separated table so column structure survives.
      sheet.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(stringifyCell(cell.value));
        });
        rows.push(cells.join("\t"));
      });
      sheetTexts.push(`=== Sheet: ${sheet.name} ===\n${rows.join("\n")}`);
    }
    return {
      text: truncate(sheetTexts.join("\n\n")),
      format: "xlsx",
      sheets: sheetNames,
    };
  }

  if (lower.endsWith(".csv")) {
    return { text: truncate(buffer.toString("utf8")), format: "csv" };
  }

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { text: truncate(buffer.toString("utf8")), format: "txt" };
  }

  throw new Error(
    `Unsupported file type: ${filename}. Supported: .docx, .xlsx, .csv, .txt, .md`,
  );
}
