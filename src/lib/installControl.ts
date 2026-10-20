/**
 * Installing a control from the catalogue, whoever asks: the /install page,
 * its form action, and the API the catalogue's own dialog calls. The control
 * comes from the catalogue of the project it goes into (fetchCataloguePackage).
 */
import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { fetchCataloguePackage } from "@/lib/cataloguePackage";
import { installChecklist, parseInstallPackage, type InstallRecorder } from "@/lib/installChecklist";
import {
  lookupInstalledChecklist,
  projectDatabaseUrl,
  writableProject,
} from "@/lib/projectDb";
import { writableProjects, type ProjectChoice } from "@/lib/writableProjects";
import { isProjectId } from "@/vendor/aisc-access/projectAccess";

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
  preselect: string;
  installed: Record<string, string>;
};

/** A refusal, with the HTTP status that says what kind it is. */
export type Refusal = { ok: false; status: number; error: string };

/** How many projects' catalogues the dialog asks for the control before it gives up. */
const FETCH_TRIES = 5;

const NO_PROJECT =
  "You cannot change any project, so there is none to install into. An owner of a project can make you an editor of it.";

/** What the dialog needs: the control as the preselected project's catalogue
 *  has it (the dialog says which), the projects this person may change, and where the control already is. */
export async function installOptions(slug: string, wanted?: string | null): Promise<Refusal | ({ ok: true } & InstallOptions)> {
  if (!slug) return { ok: false, status: 400, error: "No checklist was named. Start from the catalogue." };

  const token = await callerToken();
  const projects = await writableProjects(token, { platformUrl: platformUrl() });
  if (projects === null) {
    return { ok: false, status: 502, error: "The platform is not answering, so your projects cannot be listed. Nothing was installed." };
  }
  if (projects.length === 0) return { ok: false, status: 403, error: NO_PROJECT };
  const first =
    wanted && isProjectId(wanted) && projects.some((p) => p.pid === wanted) ? wanted : projects[0].pid;

  // The summary comes from one project's catalogue. One that has not chosen its catalogue (409), or whose
  // catalogue has no such control (404), gives way to the next project, at most FETCH_TRIES in all; the
  // first refusal is the one shown when none can give it. Other failures are not retried.
  const order = [first, ...projects.map((p) => p.pid).filter((pid) => pid !== first)].slice(0, FETCH_TRIES);
  let preselect = first;
  let fetched = await fetchCataloguePackage(first, slug, { token });
  const refusedFirst = fetched;
  for (const pid of order.slice(1)) {
    if (fetched.ok || (fetched.status !== 404 && fetched.status !== 409)) break;
    preselect = pid;
    fetched = await fetchCataloguePackage(pid, slug, { token });
  }
  if (!fetched.ok) {
    const shown = refusedFirst.ok ? fetched : refusedFirst;
    return { ok: false, status: shown.status, error: shown.reason };
  }
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
  if (!isProjectId(project)) return { ok: false, status: 400, error: "Choose a project." };
  const { prisma, refused } = await writableProject(project);
  if (refused) return { ok: false, status: 403, error: refused.error };
  const fetched = await fetchCataloguePackage(project, slug, { token: await callerToken() });
  if (!fetched.ok) return { ok: false, status: fetched.status, error: fetched.reason };
  // Only a package this app cannot read is the catalogue's fault (502). The install's own errors (a
  // database that is down, a project database that is gone: notFound) go on as they are.
  try {
    parseInstallPackage(fetched.pkg);
  } catch (err) {
    return unreadable(err);
  }
  const result = await installChecklist(prisma, fetched.pkg, record);
  const path = `/p/${encodeURIComponent(project)}/checklists/${result.checklistId}/fill?installed=${result.created ? "new" : "already"}`;
  return { ok: true, checklistId: result.checklistId, created: result.created, path };
}

/** The package could not be parsed: the catalogue sent something this app cannot read. */
function unreadable(err: unknown): Refusal {
  return { ok: false, status: 502, error: `The catalogue sent a checklist this app cannot read: ${(err as Error).message}` };
}

/** How many project databases the dialog's "already installed" look-ups open at once. */
export const LOOKUP_CONCURRENCY = 4;

/** Where the control is already installed, asked of each project read-only: listing the projects
 *  migrates none of them; the install migrates the one it goes into. `projects` is the
 *  platform's list of the projects this person may change, so each is not asked about again; and
 *  an admin's list is every project, so the look-ups take turns, LOOKUP_CONCURRENCY at a time, rather
 *  than opening one connection per project at once. */
async function installedIn(projects: ProjectChoice[], catalogueId: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const queue = projects.filter((p) => isProjectId(p.pid));
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const id = await lookupInstalledChecklist(projectDatabaseUrl(p.pid), catalogueId);
      if (id) found[p.pid] = id;
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, worker));
  return found;
}
