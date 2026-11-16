import { notFound } from "next/navigation";
import { projectDbFor } from "@/lib/projectDb";
import { buildReportPayload, type ReportInput } from "@/lib/report";
import { answerSheet } from "@/lib/answerSheet";
import { filesByQuestion } from "@/lib/proofFiles";
import { slugify } from "@/lib/slugify";
import { findCountry, findRegulation } from "@/data";
import { appBasePath } from "@/lib/appUrls";

// Always render against live data; never cache the binary.
export const dynamic = "force-dynamic";

const RENDERER_URL = process.env.PDF_RENDERER_URL ?? "http://localhost:8005";

/**
 * GET /p/{project}/submissions/{id}/report: the submission's answers and scores
 * as a PDF, made by the bundled renderer (services/pdf_renderer) and sent back as
 * a download. The app does not depend on the renderer: when it is unreachable or
 * refuses, the person is sent back to the submission, which says the PDF could
 * not be made; why goes to the log.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ project: string; id: string }> },
) {
  // The submission is read in this project's own database: a report is the
  // whole answer sheet as a document, so an id from the URL must not reach
  // another project's answers.
  const { project, id } = await params;
  const prisma = await projectDbFor(project, { write: false });

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
      nextVersion: { select: { version: true } },
    },
  });
  if (!sub) notFound();

  // As the submission's page shows it: a closed one with the questions as it answered them.
  const sheet = answerSheet(sub.status, sub.checklist.questions, sub.answers);

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
    questions: sheet.questions,
    answersByQ: sheet.answersByQ,
    scoresByQ: sheet.scoresByQ,
    versionByQ: sheet.versionByQ,
    revisionByQ: sheet.revisionByQ,
    filesByQ: await filesByQuestion(prisma, sub.id),
    // An amendment is made as the version after the one it amends, with its reason and requester.
    amendment: sub.previousVersionId && sub.amendReason && sub.amendRequestedBy
      ? { amends: sub.version - 1, reason: sub.amendReason, requestedBy: sub.amendRequestedBy }
      : null,
    replacedBy: sub.nextVersion?.version ?? null,
  };

  const payload = buildReportPayload(input, new Date());

  let res: Response;
  try {
    // The renderer refuses a caller without this app's token for it.
    const token = process.env.CONTROLS_WEB_TO_PDF_TOKEN;
    res = await fetch(`${RENDERER_URL}/render/pdf`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "X-AISC-Service-Token": token } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err) {
    console.error(
      `controls: PDF renderer unreachable at ${RENDERER_URL} (in AISC the service is controls-pdf): ${String(err)}`,
    );
    return backToSubmission(project, id);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`controls: PDF renderer answered ${res.status}: ${detail.slice(0, 2000)}`);
    return backToSubmission(project, id);
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

/** The submission's page, saying the PDF could not be made. */
function backToSubmission(project: string, id: string): Response {
  const page = `${appBasePath()}/p/${encodeURIComponent(project)}/submissions/${encodeURIComponent(id)}?report=failed`;
  return new Response(null, { status: 303, headers: { location: page, "cache-control": "no-store" } });
}
