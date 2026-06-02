export default function SiteHeader() {
  // Static files in public/ are not prefixed with the configured basePath the
  // way Next's own /_next assets are, so build the src explicitly. Read at
  // render time on the server (same runtime NEXT_BASE_PATH next.config uses).
  const basePath = process.env.NEXT_BASE_PATH || "";
  return (
    <header className="site-header">
      <div className="inner">
        <a href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/laif-logo.svg`} alt="Luxembourg AI Factory" />
        </a>
        <nav>
          <a href="/checklists">Library</a>
          <a href="/submissions">Answered checklists</a>
        </nav>
      </div>
    </header>
  );
}
