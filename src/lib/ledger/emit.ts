/**
 * The app's ledger emitter.
 *
 * An event is written with the project database's `ledger.emit(jsonb)` in the
 * same transaction as the change it describes, so a rollback leaves no event
 * and a committed change always has one. The app never names who acted: it
 * cites the request the gateway witnessed (X-AISC-Request-Id), and the
 * platform's relay takes the person from that witness record. It sends plain
 * content; the platform computes every keyed digest.
 *
 * Nothing is written while LEDGER_MODE is off (the default), so rows don't
 * pile up before the ledger is turned on.
 */
import { randomUUID } from "node:crypto";

import { ledgerSafe } from "./canonical";

export type LedgerEvent = {
  action: string;
  itemType: string;
  itemId: string | null;
  details?: Record<string, unknown>;
  content?: unknown;
  before?: unknown;
  after?: unknown;
  itemVersion?: string | number | null;
  runId?: string | null;
  /** The model behind an AI event (agent.*, card.augmented_by_ai). */
  model?: string | null;
  requestId?: string | null;
  eventId?: string;
};

/** Anything with Prisma's $executeRaw: the transaction client of `prisma.$transaction(async (tx) => ...)`. */
export type RawExecutor = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
};

export function ledgerOn(): boolean {
  const mode = (process.env.LEDGER_MODE ?? "off").trim().toLowerCase();
  return mode === "record" || mode === "enforce";
}

/** The request the gateway witnessed for the request being served, or null outside one. */
export async function currentRequestId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-aisc-request-id");
  } catch {
    return null; // not inside a request (a script, a test)
  }
}

/** Whether the request being served is a server action's POST (Next-Action), which re-renders its page. */
export async function isServerAction(): Promise<boolean> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).has("next-action");
  } catch {
    return false;
  }
}

/** Fields that would name who acted: the witness says who did, an event never does. */
const WHO_FIELDS = new Set(["createdBy", "created_by", "updatedBy", "updated_by", "savedBy"]);

/** `value` without any field that names a person, at any depth. */
export function withoutAuthors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAuthors);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !WHO_FIELDS.has(k))
        .map(([k, v]) => [k, withoutAuthors(v)]),
    );
  }
  return value;
}

/** The JSON the emitter writes; exported for the tests. Throws NotCanonical for a value the ledger can't keep. */
export function eventBody(event: LedgerEvent, requestId: string | null): string {
  const body: Record<string, unknown> = {
    event_id: event.eventId ?? randomUUID(),
    request_id: event.requestId ?? requestId,
    action: event.action,
    item_type: event.itemType,
    item_id: event.itemId,
    details: event.details ?? {},
  };
  if (event.content !== undefined) body.content = withoutAuthors(event.content);
  if (event.before !== undefined) body.before = withoutAuthors(event.before);
  if (event.after !== undefined) body.after = withoutAuthors(event.after);
  if (event.itemVersion !== undefined && event.itemVersion !== null) body.item_version = String(event.itemVersion);
  if (event.runId) body.run_id = event.runId;
  if (event.model) body.model = event.model;
  const sent = JSON.stringify(body);
  ledgerSafe(JSON.parse(sent)); // check what is sent (undefined fields dropped): refuse now what the ledger would refuse later
  return sent;
}

/** Queue one event on `tx`, inside the caller's transaction. Returns its event id, or null while the ledger is off. */
export async function emitEvent(tx: RawExecutor, event: LedgerEvent): Promise<string | null> {
  if (!ledgerOn()) return null;
  const body = eventBody(event, await currentRequestId());
  await tx.$executeRaw`SELECT ledger.emit(${body}::jsonb)`;
  return JSON.parse(body).event_id as string;
}
