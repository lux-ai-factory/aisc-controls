export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="inner">
        <a href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/laif-logo.svg" alt="Luxembourg AI Factory" />
        </a>
        <nav>
          <a href="/checklists">Library</a>
          <a href="/submissions">Answered checklists</a>
        </nav>
      </div>
    </header>
  );
}
