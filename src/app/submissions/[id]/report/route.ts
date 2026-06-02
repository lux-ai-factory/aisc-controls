import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildReportPayload, type ReportInput } from "@/lib/report";
import { slugify } from "@/lib/slugify";
import { findCountry, findRegulation } from "@/data";

// Always render against live data; never cache the binary.
export const dynamic = "force-dynamic";

const RENDERER_URL = process.env.PDF_RENDERER_URL ?? "http://localhost:8005";

/**
 * GET /submissions/:id/report — renders the submission's answers + scores to a
 * PDF via the bundled renderer (services/pdf_renderer) and streams it back as a
 * download. The core app does not depend on the renderer; if it is unreachable
 * we return a 502 with a hint rather than crashing the page.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sub = await prisma.submission.findUnique({
    where: { id },
    include: {
      checklist: {
        include: {
          questions: { orderBy: { order: "asc" } },
          source: { select: { name: true } },
        },
      },
      answers: true,
    },
  });
  if (!sub) notFound();

  const answersByQ: Record<string, string> = {};
  const scoresByQ: Record<string, number> = {};
  for (const a of sub.answers) {
    if (a.answer != null) answersByQ[a.questionId] = a.answer;
    if (a.score != null) scoresByQ[a.questionId] = a.score;
  }

  const input: ReportInput = {
    label: sub.label,
    status: sub.status,
    version: sub.version,
    createdAt: sub.createdAt,
    closedAt: sub.closedAt,
    checklistTitle: sub.checklist.title,
    sourceName: sub.checklist.source.name,
    controlTopic: sub.checklist.controlTopic,
    countries: sub.checklist.countryIds
      .map((cid) => findCountry(cid)?.name)
      .filter((n): n is string => Boolean(n)),
    regulations: sub.checklist.regulationIds
      .map((rid) => findRegulation(rid)?.name)
      .filter((n): n is string => Boolean(n)),
    questions: sub.checklist.questions.map((q) => ({
      id: q.id,
      order: q.order,
      text: q.text,
      article: q.article,
      category: q.category,
    })),
    answersByQ,
    scoresByQ,
  };

  const payload = buildReportPayload(input, new Date());

  let res: Response;
  try {
    res = await fetch(`${RENDERER_URL}/render/pdf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err) {
    return new Response(
      `PDF renderer unreachable at ${RENDERER_URL}. ` +
        "Start it with `docker compose up -d pdf`.\n\n" +
        String(err),
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return new Response(`PDF renderer returned ${res.status}.\n${detail}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const pdf = await res.arrayBuffer();
  const filename = `${slugify(sub.label) || "report"}-v${sub.version}.pdf`;
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(pdf.byteLength),
    },
  });
}
