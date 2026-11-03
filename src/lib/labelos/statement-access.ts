/**
 * Who may read, and so act on, a statement (LABEL-63). Pure.
 *
 *  · staff (`finance.read`, never role `artist`): every statement of the org, or — for a member
 *    limited to some artists — those of their artists. A payee with no roster artist is
 *    whole-org only (the database says the same).
 *  · the payee's own artist (a roster artist scoped to the payee's contact, or the owner of an
 *    ARTIST org for its one self artist — `labelos_my_payees()`, LABEL-71's identity rule): only
 *    their ISSUED statements. A party linked to an account proves nothing.
 *
 * Not being able to read a statement is 404 — the route never confirms one exists.
 */
import { scopeAllowsContact, type ArtistScope } from './artist-scope';

export type StatementReader = { kind: 'staff'; artists: ArtistScope } | { kind: 'own'; payeeIds: ReadonlySet<string> };

export function mayReadStatement(reader: StatementReader, row: { artist_contact_id: string | null; payee_id: string; status: string }): boolean {
  if (reader.kind === 'staff') return scopeAllowsContact(reader.artists, row.artist_contact_id);
  return row.status === 'issued' && reader.payeeIds.has(row.payee_id);
}

/** A payee a staff reader may act on (generate for). */
export const mayActOnPayee = (artists: ArtistScope, payee: { artist_contact_id: string | null }): boolean => scopeAllowsContact(artists, payee.artist_contact_id);
