/**
 * The files that prove an answer, as this app links them.
 *
 * What a file may be is the platform's rule (src/lib/proofStore.ts sends it there); this module keeps
 * only the links: a file is attached to a question of a draft, at most MAX_FILES_PER_QUESTION per
 * question, and linked to that question's answer, which is made (with no answer yet) when the question
 * had none. Removing a file deletes its link only: the platform keeps the file. A closed submission's
 * links are frozen, and a new version starts with the previous version's links (carryProofFiles).
 *
 * Each change and its ledger event are one transaction: the route handler passes its own recorder, so
 * the event is written where the route names its action.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { MAX_FILES_PER_QUESTION, type ProofLink } from "@/lib/proofFileShape";
import { storeProofFile, type StoredFile } from "@/lib/proofStore";
import { beforeTransaction } from "@/vendor/aisc-ledger/emit";

export { formatSize, MAX_FILES_PER_QUESTION, type ProofLink } from "@/lib/proofFileShape";
/** A proof file event's details: what the file is, never its bytes. */
export type ProofDetails = {
  submission: string;
  question: string;
  file: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
};
type Tx = Prisma.TransactionClient;
export type ProofRecorder = (tx: Tx, answerId: string, details: ProofDetails) => Promise<unknown>;
export type ProofResult = { ok: true; file: ProofLink } | { ok: false; status: number; error: string };

const NOT_DRAFT = "Only a draft takes or loses files. Amend the submission first.";
const FULL = `A question takes at most ${MAX_FILES_PER_QUESTION} files. Remove one first.`;
const NO_SUBMISSION = "Submission not found.";
const NO_QUESTION = "Question not found.";
const NO_FILE = "File not found.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refused = (status: number, error: string): ProofResult => ({ ok: false, status, error });

type LinkRow = {
  fileId: string; name: string; mime: string; size: number; sha256: string; uploadedBy: string | null; uploadedAt: Date;
};

function asLink(row: LinkRow): ProofLink {
  return { id: row.fileId, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256,
           uploadedBy: row.uploadedBy, uploadedAt: row.uploadedAt.toISOString() };
}

function detailsOf(submission: string, question: string, row: LinkRow): ProofDetails {
  return { submission, question, file: row.fileId, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256 };
}

/** The submission and the question, when the question is one of its checklist's; else the refusal. */
async function locate(prisma: PrismaClient, submissionId: string, questionId: string) {
  const sub = await prisma.submission.findUnique({ where: { id: submissionId }, select: { status: true, checklistId: true } });
  if (!sub) return { refusal: refused(404, NO_SUBMISSION) };
  const question = await prisma.question.findFirst({ where: { id: questionId, checklistId: sub.checklistId }, select: { id: true } });
  if (!question) return { refusal: refused(404, NO_QUESTION) };
  return { sub };
}

async function filesOn(db: PrismaClient | Tx, submissionId: string, questionId: string): Promise<number> {
  return db.submissionAnswerFile.count({ where: { answer: { submissionId, questionId } } });
}

/** The draft locked for this change (a close or a review waits), and still a draft; else the refusal. */
async function lockDraft(tx: Tx, submissionId: string, checklistId: string): Promise<ProofResult | null> {
  // as a save does: a review replacing the checklist's questions waits, and this waits for it
  await tx.$queryRaw`SELECT id FROM controls.checklist WHERE id = ${checklistId} FOR SHARE`;
  const [now] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM controls.submission WHERE id = ${submissionId} FOR UPDATE`;
  if (!now) return refused(404, NO_SUBMISSION);
  if (now.status !== "Draft") return refused(409, NOT_DRAFT);
  return null;
}

/**
 * Attach one file to a question of a draft: the platform stores it, then the link and its event are
 * written together. The checks are made before the file is sent (no file is stored for a closed
 * submission or a full question) and again under the draft's lock.
 */
export async function attachProofFile(
  prisma: PrismaClient,
  pid: string,
  submissionId: string,
  questionId: string,
  upload: { name: string; bytes: Uint8Array },
  uploadedBy: string | null,
  record: ProofRecorder,
): Promise<ProofResult> {
  const { sub, refusal } = await locate(prisma, submissionId, questionId);
  if (refusal) return refusal;
  if (sub.status !== "Draft") return refused(409, NOT_DRAFT);
  if ((await filesOn(prisma, submissionId, questionId)) >= MAX_FILES_PER_QUESTION) return refused(409, FULL);

  const stored = await storeProofFile(pid, upload.name, upload.bytes);
  if (!stored.ok) return stored;

  await beforeTransaction();
  return prisma.$transaction(async (tx) => {
    const locked = await lockDraft(tx, submissionId, sub.checklistId);
    if (locked) return locked;
    if (!(await tx.question.findUnique({ where: { id: questionId }, select: { id: true } }))) {
      return refused(404, NO_QUESTION);                                     // a review removed it meanwhile
    }
    if ((await filesOn(tx, submissionId, questionId)) >= MAX_FILES_PER_QUESTION) return refused(409, FULL);
    const answer = (await tx.submissionAnswer.findUnique({ where: { submissionId_questionId: { submissionId, questionId } } }))
      ?? (await tx.submissionAnswer.create({ data: { submissionId, questionId } }));
    const { id, name, mime, size, sha256 } = stored.file;
    const link = await tx.submissionAnswerFile.create({
      data: { answerId: answer.id, fileId: id, name, mime, size, sha256, uploadedBy },
    });
    await record(tx, answer.id, detailsOf(submissionId, questionId, link));
    return { ok: true, file: asLink(link) };
  });
}

/** Unlink one file from a draft's question; the platform keeps the file. An answer that only held files
 *  and has none left goes too. */
export async function removeProofFile(
  prisma: PrismaClient,
  submissionId: string,
  questionId: string,
  fileId: string,
  record: ProofRecorder,
): Promise<ProofResult> {
  if (!UUID.test(fileId)) return refused(404, NO_FILE);
  const { sub, refusal } = await locate(prisma, submissionId, questionId);
  if (refusal) return refusal;

  await beforeTransaction();
  return prisma.$transaction(async (tx) => {
    const locked = await lockDraft(tx, submissionId, sub.checklistId);
    if (locked) return locked;
    const answer = await tx.submissionAnswer.findUnique({ where: { submissionId_questionId: { submissionId, questionId } } });
    const link = answer
      ? await tx.submissionAnswerFile.findUnique({ where: { answerId_fileId: { answerId: answer.id, fileId } } })
      : null;
    if (!answer || !link) return refused(404, NO_FILE);
    await tx.submissionAnswerFile.delete({ where: { id: link.id } });
    if (answer.answer === null && answer.score === null && (await tx.submissionAnswerFile.count({ where: { answerId: answer.id } })) === 0) {
      await tx.submissionAnswer.delete({ where: { id: answer.id } });
    }
    await record(tx, answer.id, detailsOf(submissionId, questionId, link));
    return { ok: true, file: asLink(link) };
  });
}

/** The file linked to this question of this submission, or null. */
export async function linkedFile(prisma: PrismaClient, submissionId: string, questionId: string, fileId: string) {
  if (!UUID.test(fileId)) return null;
  const row = await prisma.submissionAnswerFile.findFirst({ where: { fileId, answer: { submissionId, questionId } } });
  return row ? asLink(row) : null;
}

/** A submission's files by question, oldest first; an answer to a removed question is keyed `removed-<answer id>`
 *  as answerSheet keys it. */
export async function filesByQuestion(db: PrismaClient | Tx, submissionId: string): Promise<Record<string, ProofLink[]>> {
  const rows = await db.submissionAnswerFile.findMany({
    where: { answer: { submissionId } },
    include: { answer: { select: { id: true, questionId: true } } },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
  });
  const out: Record<string, ProofLink[]> = {};
  for (const row of rows) (out[row.answer.questionId ?? `removed-${row.answer.id}`] ??= []).push(asLink(row));
  return out;
}

/** A new version's answers get the previous version's links: the same stored files, as they were attached. */
export async function carryProofFiles(tx: Tx, previous: { id: string; questionId: string | null }[], nextSubmissionId: string) {
  const fromQuestion = new Map(previous.filter((a) => a.questionId !== null).map((a) => [a.id, a.questionId as string]));
  if (fromQuestion.size === 0) return;
  const links = await tx.submissionAnswerFile.findMany({ where: { answerId: { in: [...fromQuestion.keys()] } } });
  if (links.length === 0) return;
  const next = new Map((await tx.submissionAnswer.findMany({ where: { submissionId: nextSubmissionId } }))
    .map((a) => [a.questionId, a.id]));
  await tx.submissionAnswerFile.createMany({
    data: links.flatMap((l) => {
      const answerId = next.get(fromQuestion.get(l.answerId) ?? null);
      return answerId
        ? [{ answerId, fileId: l.fileId, name: l.name, mime: l.mime, size: l.size, sha256: l.sha256,
             uploadedBy: l.uploadedBy, uploadedAt: l.uploadedAt }]
        : [];
    }),
  });
}

/** Attach and remove are fetches from this app's own page: one from another site (a form posted there, which
 *  would carry the person's session) is refused. A browser says where a request comes from (Sec-Fetch-Site),
 *  and the page sends a header no plain form can. */
export function refuseCrossSite(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin") || request.headers.get("x-requested-with") !== "aisc-controls") {
    return Response.json({ error: "Only this app's own pages may change a submission's files." }, { status: 403 });
  }
  return null;
}

/** Content-Disposition for a download: an ASCII fallback name and the exact one (RFC 6266, RFC 5987). */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const exact = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}
