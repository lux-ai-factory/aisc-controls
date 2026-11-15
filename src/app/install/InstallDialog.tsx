"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { installChosen, type ChooseState } from "./actions";
import type { ControlSummary } from "@/lib/installControl";
import type { ProjectChoice } from "@/lib/writableProjects";

/** One screen: the control, the project to install it into, and Install. The page sits under the project
 *  it installs into (`address`), so choosing another project opens that project's install page. */
export default function InstallDialog({
  slug,
  address,
  installPageBase,
  control,
  projects,
  preselect,
  installed,
}: {
  slug: string;
  address: string;
  /** This app's base path, for the other projects' install pages. */
  installPageBase: string;
  control: ControlSummary;
  projects: ProjectChoice[];
  preselect: string;
  installed: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ChooseState, FormData>(installChosen.bind(null, address, slug), undefined);
  const [project, setProject] = useState(preselect);
  const already = installed[project];
  const shownFrom = projects.find((p) => p.pid === preselect)?.name;
  const questionCount = `${control.questions} ${control.questions === 1 ? "question" : "questions"}`;

  return (
    <form action={formAction}>
      <div className="install-control">
        <h2>{control.title}</h2>
        <p className="subtitle">{`${control.source} · ${control.topic} · ${questionCount}`}</p>
        {control.description && <p className="install-description">{control.description}</p>}
        {/* Another project's catalogue may have another version: the install takes the chosen project's */}
        {projects.length > 1 && shownFrom && <p className="install-from">{`As ${shownFrom}’s catalogue has it.`}</p>}
      </div>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="field">
        <label htmlFor="install-project">Project</label>
        <select
          id="install-project"
          name="project"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            if (e.target.value !== address) {
              window.location.assign(`${installPageBase}/p/${encodeURIComponent(e.target.value)}/install?slug=${encodeURIComponent(slug)}`);
            }
          }}
        >
          {projects.map((p) => <option key={p.pid} value={p.pid}>{p.name}</option>)}
        </select>
      </div>
      {already && (
        <p className="install-already">
          Already installed in this project. <Link href={`/p/${project}/checklists/${already}/fill`}>Open it</Link>
        </p>
      )}
      <div className="install-actions">
        <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
        {!already && <button type="submit" className="btn" disabled={pending}>{pending ? "Installing…" : "Install"}</button>}
      </div>
    </form>
  );
}

/** The catalogue opened this tab, so Cancel gives it back; a tab opened by hand goes back instead. */
function cancel() {
  window.close();
  if (!window.closed) window.history.back();
}
