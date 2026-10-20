// Renders the formal "Origin of the data" citation, the source URL, and the
// document's last-update date. Each part is optional; the component returns
// null if there's nothing to show. Used on the library cards and on the fill /
// detail pages so the formatting stays consistent.

import { formatDate } from "@/lib/formatDate";

type Props = {
  citation?: string | null;
  url?: string | null;
  sourceUpdatedAt?: Date | null;
};

export default function SourceCitation({
  citation,
  url,
  sourceUpdatedAt,
}: Props) {
  const parts: React.ReactNode[] = [];

  if (citation) parts.push(citation);
  if (url) {
    parts.push(
      <a key="url" href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
  }
  if (sourceUpdatedAt) {
    parts.push(`Last updated ${formatDate(sourceUpdatedAt)}`);
  }

  if (parts.length === 0) return null;

  return (
    <p className="citation">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </p>
  );
}
