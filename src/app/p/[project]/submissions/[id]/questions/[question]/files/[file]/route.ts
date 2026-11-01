/**
 * One proof file of a question of a submission.
 *
 * GET downloads it, for anybody in the project: its bytes come from the platform and are always sent as a
 * download, never shown in the page (Content-Disposition attachment, nosniff, and a sandbox policy for a
 * browser that opens it anyway).
 *
 * DELETE unlinks it from a draft's answer and records `control.proof.removed`; the platform keeps the file.
 */
import { projectDbFor, writableProject } from "@/lib/projectDb";
import { attachmentHeader, linkedFile, refuseCrossSite, removeProofFile } from "@/lib/proofFiles";
import { readProofFile } from "@/lib/proofStore";
import { emitEvent } from "@/vendor/aisc-ledger/emit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ project: string; id: string; question: string; file: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { project, id, question, file } = await params;
  const prisma = await projectDbFor(project, { write: false });
  const link = await linkedFile(prisma, id, question, file);
  if (!link) return Response.json({ error: "File not found." }, { status: 404 });
  let stored: Response | null;
  try {
    stored = await readProofFile(project.toLowerCase(), link.id);
  } catch (err) {
    console.warn(`controls: a proof file could not be read from the platform (${(err as Error)?.message})`);
    return Response.json({ error: "The file store cannot be reached just now." }, { status: 502 });
  }
  if (!stored) return Response.json({ error: "The file is not in the store." }, { status: 404 });
  const headers = new Headers({
    "content-type": link.mime,
    "content-disposition": attachmentHeader(link.name),
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "cache-control": "private, no-store",
  });
  const length = stored.headers.get("content-length");
  if (length) headers.set("content-length", length);
  return new Response(stored.body, { status: 200, headers });
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const crossSite = refuseCrossSite(request);
  if (crossSite) return crossSite;
  const { project, id, question, file } = await params;
  const { prisma, refused } = await writableProject(project);
  if (refused) return Response.json(refused, { status: 403 });
  const result = await removeProofFile(prisma, id, question, file, (tx, answerId, details) =>
    emitEvent(tx, { action: "control.proof.removed", itemType: "answer", itemId: answerId, details }));
  return result.ok
    ? Response.json({ removed: result.file.id }, { status: 200 })
    : Response.json({ error: result.error }, { status: result.status });
}
