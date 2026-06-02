"use client";

import Link from "next/link";
import { useState } from "react";
import type { Country, Regulation, RegulationKind } from "@/data";
import type { FieldErrors } from "@/lib/checklistForm";

const REG_KIND_LABELS: Record<RegulationKind, string> = {
  regulation: "Regulations",
  directive: "Directives",
  standard: "Standards",
};

export type ChecklistMeta = {
  title: string;
  sourceId: string;
  controlTopic: string;
  description: string | null;
  sourceUpdatedAt: string | null; // YYYY-MM-DD
  countryIds: string[];
  regulationIds: string[];
};

export type SourceOption = { id: string; name: string };

const EMPTY_META: ChecklistMeta = {
  title: "",
  sourceId: "",
  controlTopic: "",
  description: null,
  sourceUpdatedAt: null,
  countryIds: [],
  regulationIds: [],
};

export default function ChecklistMetaFields({
  initial = EMPTY_META,
  countries,
  regulations,
  sources,
  fieldErrors,
}: {
  initial?: ChecklistMeta;
  countries: Country[];
  regulations: Regulation[];
  sources: SourceOption[];
  fieldErrors?: FieldErrors;
}) {
  const [meta, setMeta] = useState<ChecklistMeta>(initial);
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(
    new Set(initial.countryIds),
  );
  const [selectedRegs, setSelectedRegs] = useState<Set<string>>(
    new Set(initial.regulationIds),
  );

  const update = (patch: Partial<ChecklistMeta>) =>
    setMeta((prev) => ({ ...prev, ...patch }));

  const toggleSet = (setter: typeof setSelectedCountries, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <section className="qf-section">
        <h2>Source metadata</h2>
        <div className="field">
          <label htmlFor="title">Checklist title</label>
          <input
            id="title"
            name="title"
            value={meta.title}
            onChange={(e) => update({ title: e.target.value })}
            required
            placeholder="e.g. ENISA — AI Act Article 14 Human Oversight checks"
          />
          {fieldErrors?.title && (
            <span className="field-error">{fieldErrors.title}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="sourceId">Source / authority</label>
          {sources.length === 0 ? (
            <p className="qf-help">
              No sources registered yet.{" "}
              <Link href="/sources/new">Register one</Link> before continuing.
            </p>
          ) : (
            <select
              id="sourceId"
              name="sourceId"
              value={meta.sourceId}
              onChange={(e) => update({ sourceId: e.target.value })}
              required
            >
              <option value="">Pick a registered source…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {fieldErrors?.sourceId && (
            <span className="field-error">{fieldErrors.sourceId}</span>
          )}
          {sources.length > 0 && (
            <span className="qf-help">
              Missing one? <Link href="/sources/new">Register a new source</Link>.
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="controlTopic">What is the control about?</label>
          <input
            id="controlTopic"
            name="controlTopic"
            value={meta.controlTopic}
            onChange={(e) => update({ controlTopic: e.target.value })}
            required
            placeholder="e.g. Human oversight measures for high-risk AI systems"
          />
          {fieldErrors?.controlTopic && (
            <span className="field-error">{fieldErrors.controlTopic}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="description">Description (optional)</label>
          <textarea
            id="description"
            name="description"
            rows={2}
            value={meta.description ?? ""}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Any additional context — scope, target audience, version of the source document, etc."
          />
        </div>
        <div className="field">
          <label htmlFor="sourceUpdatedAt">Source last updated</label>
          <input
            id="sourceUpdatedAt"
            name="sourceUpdatedAt"
            type="date"
            value={meta.sourceUpdatedAt ?? ""}
            onChange={(e) => update({ sourceUpdatedAt: e.target.value || null })}
          />
          <span className="qf-help">
            Date the publishing authority last updated the source document.
            Required by some authorities (e.g. AESIA) when re-using their data.
          </span>
          {fieldErrors?.sourceUpdatedAt && (
            <span className="field-error">{fieldErrors.sourceUpdatedAt}</span>
          )}
        </div>
      </section>

      <section className="qf-section">
        <h2>Country of origin</h2>
        <p className="qf-help">
          Pick one or more jurisdictions the source applies to.{" "}
          {selectedCountries.size} selected.
        </p>
        <div className="chip-row">
          {countries.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`chip${selectedCountries.has(c.id) ? " active" : ""}`}
              onClick={() => toggleSet(setSelectedCountries, c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        {[...selectedCountries].map((id) => (
          <input key={id} type="hidden" name="countryIds" value={id} />
        ))}
        {fieldErrors?.countryIds && (
          <span className="field-error">{fieldErrors.countryIds}</span>
        )}
      </section>

      <section className="qf-section">
        <h2>Regulation / standard</h2>
        <p className="qf-help">
          Pick every regulation, directive, or standard this checklist is
          built on. {selectedRegs.size} selected.
        </p>
        <div className="reg-list">
          {(Object.keys(REG_KIND_LABELS) as RegulationKind[]).map((kind) => (
            <div key={kind} className="reg-group">
              <h4>{REG_KIND_LABELS[kind]}</h4>
              <div className="chip-row">
                {regulations
                  .filter((r) => r.kind === kind)
                  .map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className={`chip${selectedRegs.has(r.id) ? " active" : ""}`}
                      onClick={() => toggleSet(setSelectedRegs, r.id)}
                      title={r.reference}
                    >
                      {r.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        {[...selectedRegs].map((id) => (
          <input key={id} type="hidden" name="regulationIds" value={id} />
        ))}
        {fieldErrors?.regulationIds && (
          <span className="field-error">{fieldErrors.regulationIds}</span>
        )}
      </section>
    </>
  );
}
