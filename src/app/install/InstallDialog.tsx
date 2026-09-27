"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { installChosen, type ChooseState } from "./actions";
import type { ControlSummary } from "@/lib/installControl";
import type { ProjectChoice } from "@/lib/writableProjects";

/** One screen: the control, the project, Install. Like the engine's dialog for a test. */
export default function InstallDialog({
  slug,
  control,
  projects,
  preselect,
  installed,
}: {
  slug: string;
  control: ControlSummary;
  projects: ProjectChoice[];
  preselect: string;
  installed: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ChooseState, FormData>(installChosen.bind(null, slug), undefined);
  const [project, setProject] = useState(preselect);
  const already = installed[project];
  const questionCount = `${control.questions} ${control.questions === 1 ? "question" : "questions"}`;

  return (
    <form action={formAction}>
      <div className="install-control">
        <h2>{control.title}</h2>
        <p className="subtitle">{`${control.source} · ${control.topic} · ${questionCount}`}</p>
        {control.description && <p className="install-description">{control.description}</p>}
      </div>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="field">
        <label htmlFor="install-project">Project</label>
        <select
          id="install-project"
          name="project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
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
