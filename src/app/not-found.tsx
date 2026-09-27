import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="empty-state">
        <h1>Not found</h1>
        <p>The page or record you&rsquo;re looking for doesn&rsquo;t exist.</p>
        <Link className="btn" href="/">
          Back to your projects
        </Link>
      </div>
    </main>
  );
}
