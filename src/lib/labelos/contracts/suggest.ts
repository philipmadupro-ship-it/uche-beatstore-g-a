/**
 * Merge-field suggestions (LABEL-58). Pure. Two sources, both optional:
 *
 *  · LABEL-28 split sheets — the contract's song has a sheet in force (not a
 *    draft, not superseded); a contract party that has a line on it gets that
 *    share offered for `master_share` / `publishing_share`. Shares are
 *    integers of 0.0001 % and are formatted from the integer, never a float.
 *  · LABEL-54 parties — the parties that stand for the contract's artist
 *    (`parties.contact_id`) are offered for the artist slot.
 *
 * A suggestion is only ever offered; nothing is applied until the person
 * clicks it. No payee data (tax id, payment instructions) is read here.
 */
import { formatShare, isLive } from '../splits';
import type { PartyRole } from './types';

export type SplitFacts = { kind: string; status: string; version: number; lines: { party_id: string; units: number }[] };

export type FieldSuggestion = { key: 'master_share' | 'publishing_share'; value: string; source: string; partyId: string };

const FIELD_OF = { master: 'master_share', composition: 'publishing_share' } as const;

export function suggestFromSplits(
  sheets: readonly SplitFacts[],
  contractParties: readonly { party_id: string; role: PartyRole; name: string }[],
): FieldSuggestion[] {
  const out: FieldSuggestion[] = [];
  const people = contractParties.filter((p) => p.role !== 'label');
  for (const kind of ['master', 'composition'] as const) {
    // At most one sheet is in force per song and kind (migration 155); the newest wins if data says otherwise.
    const live = sheets.filter((s) => s.kind === kind && isLive(s.status)).sort((a, b) => b.version - a.version)[0];
    if (!live) continue;
    for (const p of people) {
      const units = live.lines.filter((l) => l.party_id === p.party_id).reduce((n, l) => n + l.units, 0);
      if (units <= 0) continue;
      out.push({ key: FIELD_OF[kind], value: formatShare(units), source: `${kind === 'master' ? 'Master' : 'Composition'} split v${live.version} · ${p.name}`, partyId: p.party_id });
    }
  }
  return out;
}

/** Parties that stand for this artist (the CRM contact), offered for the artist slot. */
export function suggestArtistParties<P extends { id: string; contact_id: string | null }>(parties: readonly P[], artistContactId: string | null): P[] {
  if (!artistContactId) return [];
  return parties.filter((p) => p.contact_id === artistContactId);
}
