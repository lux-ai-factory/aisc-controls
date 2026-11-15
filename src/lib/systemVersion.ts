/**
 * The AI card version an answer is given under: the project's latest saved card version, and the revision
 * its card is at.
 *
 * An answer carries it, so a result can be read against the card that was in force when it was given.
 * It is read from project.saved_system in the save's own transaction (the versions live in the same
 * project database), never from the platform over the network: a platform that is slow or silent cannot
 * leave a new answer unstamped. The read first takes a shared lock on the key the platform takes to make
 * or correct a version, so no version is made or corrected between this read and the save's commit: an
 * answer never carries a version older than one that existed when it was stored. Null: the project has no
 * card version yet.
 */
import type { Prisma } from "@prisma/client";

export type CardStamp = { pid: string; number: number; revision: number };

export async function latestVersion(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<CardStamp | null> {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock_shared(hashtext('project.system'))) l`;
  const [latest] = await tx.$queryRaw<{ pid: string; number: number; card_revision: number }[]>`
    SELECT pid::text AS pid, number, card_revision FROM project.saved_system ORDER BY number DESC LIMIT 1`;
  return latest
    ? { pid: latest.pid, number: Number(latest.number), revision: Number(latest.card_revision) }
    : null;
}
