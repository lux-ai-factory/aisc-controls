import { launcherUrl } from "@/lib/appUrls";

/** The launcher lists the projects: this app's own root has no list, it only sends you there. */
export default function NotFound() {
  return (
    <main className="page">
      <div className="empty-state">
        <h1>Not found</h1>
        <p>The page or record you&rsquo;re looking for doesn&rsquo;t exist.</p>
        <a className="btn" href={launcherUrl()}>
          ← Projects
        </a>
      </div>
    </main>
  );
}
