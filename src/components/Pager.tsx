import Link from "next/link";
import { pageHref } from "@/lib/pagination";

type Props = {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  totalPages: number;
};

/** Previous · Page X of Y · Next; nothing when the list fits on one page. */
export default function Pager({ base, params, page, totalPages }: Props) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? (
        <Link className="btn ghost" href={pageHref(base, params, page - 1)}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="pager-status">{`Page ${page} of ${totalPages}`}</span>
      {page < totalPages ? (
        <Link className="btn ghost" href={pageHref(base, params, page + 1)}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
