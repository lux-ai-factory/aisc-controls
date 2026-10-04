/**
 * Installing a control from the catalogue, whoever asks: the /install page,
 * its form action, and the API the catalogue's own dialog calls. The control
 * comes from the catalogue of the project it goes into (fetchCataloguePackage).
 */
import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { fetchCataloguePackage } from "@/lib/cataloguePackage";
import { installChecklist, parseInstallPackage, type InstallRecorder } from "@/lib/installChecklist";
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

const NO_PROJECT =
  "You cannot change any project, so there is none to install into. An owner of a project can make you an editor of it.";

/** What the dialog needs: the control as the preselected project's catalogue
 *  has it, the projects this person may change, and where the control already is. */
export async function installOptions(slug: string, wanted?: string | null): Promise<Refusal | ({ ok: true } & InstallOptions)> {
  if (!slug) return { ok: false, status: 400, error: "No control was named. Start from the catalogue." };

  const token = await callerToken();
  const projects = await writableProjects(token, { platformUrl: platformUrl() });
  if (projects === null) {
    return { ok: false, status: 502, error: "The platform is not answering, so your projects cannot be listed. Nothing was installed." };
  }
  if (projects.length === 0) return { ok: false, status: 403, error: NO_PROJECT };
  const preselect =
    wanted && PROJECT_ID.test(wanted) && projects.some((p) => p.pid === wanted) ? wanted : projects[0].pid;

  const fetched = await fetchCataloguePackage(preselect, slug, { token });
  if (!fetched.ok) return { ok: false, status: fetched.status, error: fetched.reason };
  let parsed;
  try {
    parsed = parseInstallPackage(fetched.pkg);
  } catch (err) {
    return unreadable(err);
  }

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
  record?: InstallRecorder,
): Promise<Refusal | { ok: true; checklistId: string; created: boolean; path: string }> {
  if (!PROJECT_ID.test(project)) return { ok: false, status: 400, error: "Choose a project." };
  const { prisma, refused } = await writableProject(project);
  if (refused) return { ok: false, status: 403, error: refused.error };
  const fetched = await fetchCataloguePackage(project, slug, { token: await callerToken() });
  if (!fetched.ok) return { ok: false, status: fetched.status, error: fetched.reason };
  let result;
  try {
    result = await installChecklist(prisma, fetched.pkg, record);
  } catch (err) {
    return unreadable(err);
  }
  const path = `/p/${encodeURIComponent(project)}/checklists/${result.checklistId}/fill?installed=${result.created ? "new" : "already"}`;
  return { ok: true, checklistId: result.checklistId, created: result.created, path };
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
