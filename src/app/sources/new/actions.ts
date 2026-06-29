"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slugify";
import { auditEvent } from "@/lib/audit";

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
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    citation: formData.get("citation") ?? undefined,
    url: formData.get("url") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const name = parsed.data.name;
  const citation = parsed.data.citation?.length ? parsed.data.citation : null;
  const url = parsed.data.url?.length ? parsed.data.url : null;
  const baseSlug = slugify(name) || name.toLowerCase();

  const dupName = await prisma.source.findUnique({
    where: { name },
    select: { id: true },
  });
  if (dupName) return { error: `"${name}" is already registered.` };

  // disambiguate slug if needed
  let slug = baseSlug;
  let n = 2;
  while (await prisma.source.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${baseSlug}-${n++}`;
  }

  await prisma.source.create({ data: { name, slug, citation, url } });
  await auditEvent({ token: formData.get("kc_token")?.toString(), what: "source:create",
                     consequence: { name, slug } });
  redirect("/sources");
}
