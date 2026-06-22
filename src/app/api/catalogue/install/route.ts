import { prisma } from "@/lib/prisma";
import { installChecklist } from "@/lib/installChecklist";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalogue/install — ingest a checklist template pushed by the
 * catalogue. The catalogue builds the package (mapping lives there); this route
 * just upserts it. Returns { checklistId, catalogueId, created }.
 */
export async function POST(req: Request) {
  let pkg: unknown;
  try {
    pkg = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const result = await installChecklist(prisma, pkg);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 422 });
  }
}
