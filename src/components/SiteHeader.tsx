export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="inner">
        <a href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/laif-logo.svg" alt="Luxembourg AI Factory" />
        </a>
        <nav>
          <a href="/questionnaires">Library</a>
          <a href="/sources">Sources</a>
          <a href="/submissions">Compiled forms</a>
        </nav>
      </div>
    </header>
  );
}
