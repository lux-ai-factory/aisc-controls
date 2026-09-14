import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalogue/installed — the catalogue ids of every checklist installed
 * from the catalogue, so the catalogue UI can show "Installed ✓".
 */
export async function GET() {
  const rows = await prisma.checklist.findMany({
    where: { catalogueId: { not: null } },
    select: { catalogueId: true },
  });
  return Response.json({ catalogueIds: rows.map((r) => r.catalogueId) });
}
