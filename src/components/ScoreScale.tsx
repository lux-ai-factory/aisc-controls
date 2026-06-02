"use client";

import { SCORE_LABELS, SCORE_VALUES } from "@/lib/scoring";

// Radio scale (1–5 plus "No score") for rating one question's readiness.
// Shared by the fill form and the draft editor. `currentScore` pre-selects a
// value; when it is undefined the "No score" option is checked instead.
export default function ScoreScale({
  questionId,
  currentScore,
}: {
  questionId: string;
  currentScore?: number;
}) {
  const name = `s:${questionId}`;
  return (
    <fieldset className="score-scale" aria-label="Readiness">
      <legend>Readiness</legend>
      {SCORE_VALUES.map((n) => (
        <label key={n} className="score-option">
          <input
            type="radio"
            name={name}
            value={n}
            defaultChecked={currentScore === n}
          />
          <span className="score-number">{n}</span>
          <span className="score-label">{SCORE_LABELS[n]}</span>
        </label>
      ))}
      <label className="score-option score-option--clear">
        <input
          type="radio"
          name={name}
          value=""
          defaultChecked={currentScore === undefined}
        />
        <span className="score-number">—</span>
        <span className="score-label">No score</span>
      </label>
    </fieldset>
  );
}
