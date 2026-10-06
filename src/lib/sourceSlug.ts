import type { Prisma, PrismaClient } from "@prisma/client";
import { slugify } from "@/lib/slugify";

/**
 * A slug for a new source named `name` that no source has yet: its slugified name, or "source" when
 * nothing of the name survives slugify (a name with no Latin letters or digits), then -2, -3, ... while
 * taken. Shared by registering a source by hand and by a control's install (code review 2026-10-06: the
 * install used the bare slug, so a taken or empty one failed every time).
 */
export async function freeSourceSlug(
  db: PrismaClient | Prisma.TransactionClient,
  name: string,
): Promise<string> {
  const base = slugify(name) || "source";
  let slug = base;
  for (let n = 2; await db.source.findUnique({ where: { slug }, select: { id: true } }); n++) {
    slug = `${base}-${n}`;
  }
  return slug;
}
