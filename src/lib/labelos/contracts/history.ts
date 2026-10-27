/**
 * The per-version history of a contract (LABEL-58). Pure. Built from the
 * contract's own activity events: the payloads name field keys and clause ids
 * (never wording or amounts — LABEL-57), so history says WHICH clauses
 * changed in each version, and the clause headings come from the contract as
 * it stands now. Newest first.
 */
export type HistoryEvent = { id: string; verb: string; actor_id: string | null; created_at: string; payload: Record<string, unknown> | null };

export type HistoryKind = 'created' | 'edited' | 'sent' | 'voided' | 'document';

export type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  at: string;
  actorId: string | null;
  /** The contract version this event produced; null for events that predate versions. */
  version: number | null;
  /** Detail field keys that changed (title, fields, parties, …). */
  changed: string[];
  /** Clause ids that were edited, added or removed. */
  clauseIds: string[];
  /** Headings for `clauseIds` when the clause still exists. */
  clauses: { id: string; heading: string | null }[];
};

const KIND: Record<string, HistoryKind> = {
  'contract.created': 'created',
  'contract.updated': 'edited',
  'contract.sent': 'sent',
  'contract.voided': 'voided',
  'contract.document_generated': 'document',
};

export const HISTORY_VERBS = Object.keys(KIND);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function buildHistory(events: readonly HistoryEvent[], headingOf: (clauseId: string) => string | null): HistoryEntry[] {
  return events
    .filter((e) => e.verb in KIND)
    .map((e) => {
      const p = e.payload ?? {};
      const clauseIds = strings(p.changed_clauses);
      return {
        id: e.id,
        kind: KIND[e.verb],
        at: e.created_at,
        actorId: e.actor_id,
        version: typeof p.version === 'number' && Number.isInteger(p.version) ? p.version : null,
        changed: strings(p.changed).filter((k) => k !== 'clauses'),
        clauseIds,
        clauses: clauseIds.map((id) => ({ id, heading: headingOf(id) })),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
