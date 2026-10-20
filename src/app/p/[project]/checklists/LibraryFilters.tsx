"use client";

import type { Country, Regulation } from "@/data";

type Source = { id: string; name: string };

type Current = {
  country: string | null;
  regulation: string | null;
  source: string | null;
  search: string | null;
};

export default function LibraryFilters({
  countries,
  regulations,
  sources,
  current,
}: {
  countries: Country[];
  regulations: Regulation[];
  sources: Source[];
  current: Current;
}) {
  return (
    <form method="get" className="library-filters">
      <div className="field">
        <label htmlFor="q">Search</label>
        <input
          id="q"
          name="q"
          defaultValue={current.search ?? ""}
          placeholder="Title, topic, description…"
        />
      </div>
      <div className="field">
        <label htmlFor="source">Source / authority</label>
        <select id="source" name="source" defaultValue={current.source ?? ""}>
          <option value="">Any</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="country">Country</label>
        <select id="country" name="country" defaultValue={current.country ?? ""}>
          <option value="">Any</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="regulation">Regulation / standard</label>
        <select
          id="regulation"
          name="regulation"
          defaultValue={current.regulation ?? ""}
        >
          <option value="">Any</option>
          {regulations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="library-filter-actions">
        <button type="submit" className="btn">
          Apply
        </button>
      </div>
    </form>
  );
}
