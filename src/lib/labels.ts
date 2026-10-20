// The words a submission's stored values are shown in. The database keeps its own
// values (status "Closed", a score 1-5); only what a person reads is named here.
import { SCORE_LABELS } from "./scoring";

/** A submission's status as shown: a closed one is "Final". */
export function statusLabel(status: string): string {
  return status === "Closed" ? "Final" : status;
}

/** One question's score as shown, e.g. "Maturity 4/5 (Established)". */
export function maturityLabel(score: number): string {
  const name = SCORE_LABELS[score];
  return name ? `Maturity ${score}/5 (${name})` : `Maturity ${score}/5`;
}
