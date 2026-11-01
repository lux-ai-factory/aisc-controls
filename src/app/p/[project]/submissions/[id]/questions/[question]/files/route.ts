/**
 * POST /p/{project}/submissions/{id}/questions/{question}/files: attach one file (the form field `file`)
 * to a question of a draft. The platform checks and stores the file; this links it to the question's
 * answer and records `control.proof.attached` in the same transaction (src/lib/proofFiles.ts). Answers
 * 201 {file}, or {error} with the reason: 403 not allowed, 404, 409 not a draft or the question is full,
 * 413/415/422 the platform's refusal of the file, 503 the store is not reachable.
 */
import { writableProject } from "@/lib/projectDb";
import { callerName } from "@/lib/access/callerName";
import { attachProofFile, refuseCrossSite } from "@/lib/proofFiles";
import { emitEvent } from "@/vendor/aisc-ledger/emit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ project: string; id: string; question: string }> },
): Promise<Response> {
  const crossSite = refuseCrossSite(request);
  if (crossSite) return crossSite;
  const { project, id, question } = await params;
  const { prisma, refused } = await writableProject(project);
  if (refused) return Response.json(refused, { status: 403 });

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return Response.json({ error: "The upload could not be read: a file is at most 25 MB." }, { status: 413 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to attach." }, { status: 400 });

  const result = await attachProofFile(
    prisma, project.toLowerCase(), id, question,
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    await callerName(),
    (tx, answerId, details) =>
      emitEvent(tx, { action: "control.proof.attached", itemType: "answer", itemId: answerId, details }),
  );
  return result.ok
    ? Response.json({ file: result.file }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
