/**
 * Installing a control from the catalogue, whoever asks: the /install page,
 * its form action, and the API the catalogue's own dialog calls.
 */
import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { fetchCataloguePackage } from "@/lib/cataloguePackage";
import { installChecklist, parseInstallPackage } from "@/lib/installChecklist";
import { PROJECT_ID, projectDbFor, writableProject } from "@/lib/projectDb";
import { writableProjects, type ProjectChoice } from "@/lib/writableProjects";

export type ControlSummary = {
  title: string;
  source: string;
  topic: string;
  questions: number;
  description: string | null;
};

export type InstallOptions = {
  control: ControlSummary;
  projects: ProjectChoice[];
  preselect: string | null;
  installed: Record<string, string>;
};

/** A refusal, with the HTTP status that says what kind it is. */
export type Refusal = { ok: false; status: number; error: string };

/** What the dialog needs: the control, the projects this person may change,
 *  which one to preselect, and where the control already is. */
export async function installOptions(slug: string, wanted?: string | null): Promise<Refusal | ({ ok: true } & InstallOptions)> {
  if (!slug) return { ok: false, status: 400, error: "No control was named. Start from the catalogue." };

  const fetched = await fetchCataloguePackage(slug);
  if (!fetched.ok) return catalogueRefusal(fetched.reason);
  let parsed;
  try {
    parsed = parseInstallPackage(fetched.pkg);
  } catch (err) {
    return unreadable(err);
  }

  const projects = await writableProjects(await callerToken(), { platformUrl: platformUrl() });
  if (projects === null) {
    return { ok: false, status: 502, error: "The platform is not answering, so your projects cannot be listed. Nothing was installed." };
  }

  const preselect =
    wanted && PROJECT_ID.test(wanted) && projects.some((p) => p.pid === wanted) ? wanted : (projects[0]?.pid ?? null);
  return {
    ok: true,
    control: {
      title: parsed.checklist.title,
      source: parsed.source.name,
      topic: parsed.checklist.controlTopic,
      questions: parsed.questions.length,
      description: parsed.checklist.description,
    },
    projects,
    preselect,
    installed: await installedIn(projects, parsed.checklist.catalogueId),
  };
}

/** Install into one project, after the platform says this person may change it. */
export async function installForCaller(
  project: string,
  slug: string,
): Promise<Refusal | { ok: true; checklistId: string; created: boolean; path: string }> {
  if (!PROJECT_ID.test(project)) return { ok: false, status: 400, error: "Choose a project." };
  const { prisma, refused } = await writableProject(project);
  if (refused) return { ok: false, status: 403, error: refused.error };
  const fetched = await fetchCataloguePackage(slug);
  if (!fetched.ok) return catalogueRefusal(fetched.reason);
  let result;
  try {
    result = await installChecklist(prisma, fetched.pkg);
  } catch (err) {
    return unreadable(err);
  }
  const path = `/p/${encodeURIComponent(project)}/checklists/${result.checklistId}/fill?installed=${result.created ? "new" : "already"}`;
  return { ok: true, checklistId: result.checklistId, created: result.created, path };
}

/**
 * Why the catalogue could not give the control. A missing control is a 404;
 * everything else is the catalogue not answering properly. The reason is
 * matched by its wording because fetchCataloguePackage only returns the text.
 */
function catalogueRefusal(reason: string): Refusal {
  const missing = reason.startsWith("The catalogue has no control") || reason.startsWith("That is not the name");
  return { ok: false, status: missing ? 404 : 502, error: reason };
}

/** Parsing or installing the package threw; either way it is reported as unreadable. */
function unreadable(err: unknown): Refusal {
  return { ok: false, status: 502, error: `The catalogue sent a control this app cannot read: ${(err as Error).message}` };
}

async function installedIn(projects: ProjectChoice[], catalogueId: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  await Promise.all(
    projects.map(async (p) => {
      try {
        const prisma = await projectDbFor(p.pid, { write: false });
        const row = await prisma.checklist.findUnique({ where: { catalogueId }, select: { id: true } });
        if (row) found[p.pid] = row.id;
      } catch {
        // A project whose database cannot be read is not known to have it; the
        // install checks again and says why if it cannot write either.
      }
    }),
  );
  return found;
}
