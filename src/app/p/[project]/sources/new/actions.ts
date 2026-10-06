"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writableProject } from "@/lib/projectDb";
import { freeSourceSlug } from "@/lib/sourceSlug";
import { emitEvent } from "@/lib/ledger/emit";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  citation: z.string().trim().max(500).optional(),
  url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), "URL must start with http(s)://"),
});

export type CreateState = { error?: string } | undefined;

export async function createSource(
  project: string,
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const { prisma, refused } = await writableProject(project);
  if (refused) return refused;
  const parsed = schema.safeParse({
    name: formData.get("name"),
    citation: formData.get("citation") ?? undefined,
    url: formData.get("url") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const name = parsed.data.name;
  const citation = parsed.data.citation?.length ? parsed.data.citation : null;
  const url = parsed.data.url?.length ? parsed.data.url : null;
  const already = { error: `"${name}" is already registered.` };

  // Checked and made in one transaction; two editors registering at once both pass the checks, and the
  // unique name or slug stops the second: it is told the source is registered (a slug that only clashed is
  // tried once more with the next free one).
  const register = () => prisma.$transaction(async (tx) => {
    if (await tx.source.findUnique({ where: { name }, select: { id: true } })) return false;
    const slug = await freeSourceSlug(tx, name);
    const made = await tx.source.create({ data: { name, slug, citation, url } });
    await emitEvent(tx, {
      action: "controls.source.created",
      itemType: "source",
      itemId: made.id,
      content: { name, slug, citation, url },
    });
    return true;
  });
  let registered: boolean;
  try {
    registered = await register();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== "P2002") throw err;
    registered = await register();
  }
  if (!registered) return already;
  redirect(`/p/${project}/sources`);
}
