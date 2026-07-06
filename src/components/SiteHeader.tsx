import AuthButtons from "@/components/AuthButtons";

export default function SiteHeader() {
  // Neither static files in public/ nor raw <a href> links are prefixed with
  // the configured basePath the way Next's own /_next assets and <Link>
  // navigations are, so build them explicitly. Read at render time on the
  // server (same runtime NEXT_BASE_PATH next.config uses).
  const basePath = process.env.NEXT_BASE_PATH || "";
  return (
    <header className="site-header">
      <div className="inner">
        <a href={`${basePath}/`} className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/laif-logo.svg`} alt="Luxembourg AI Factory" />
        </a>
        <nav>
          <a href={`${basePath}/checklists`}>Library</a>
          <a href={`${basePath}/submissions`}>Answered checklists</a>
          <AuthButtons />
        </nav>
      </div>
    </header>
  );
}
