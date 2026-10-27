/**
 * Who reads which contract, and what they see of it (LABEL-57). Pure; the SQL
 * twin is the `contracts_member_read` policy (migration 176).
 *
 *  - A member with `contracts.read` (never role `artist`) reads every
 *    contract in their artist scope. A contract naming no roster artist is
 *    visible only to a whole-org member.
 *  - Anyone else in the org reads only contracts that have LEFT DRAFT and
 *    name them: they are a party (their party's `user_id`), or — for a roster
 *    artist — the contract's artist is one of their own contacts. Another
 *    artist's contract does not exist for them (404).
 *  - The internal note and who drafted the contract are the business side's.
 */
import { scopeAllowsContact, type ArtistScope } from '../artist-scope';
import type { ContractStatus } from './types';

export type ContractActor = {
  role: string;
  capabilities: ReadonlySet<string>;
  artistScope: ArtistScope;
  /** Parties of this org linked to the caller's account. */
  ownPartyIds: ReadonlySet<string>;
};

export type ContractAccessRow = {
  status: ContractStatus;
  artist_contact_id: string | null;
  partyIds: readonly string[];
};

export function readsAllContracts(actor: Pick<ContractActor, 'role' | 'capabilities'>): boolean {
  return actor.role !== 'artist' && actor.capabilities.has('contracts.read');
}

export function mayReadContract(actor: ContractActor, row: ContractAccessRow): boolean {
  if (readsAllContracts(actor)) return scopeAllowsContact(actor.artistScope, row.artist_contact_id);
  if (row.status === 'draft') return false;
  if (row.partyIds.some((id) => actor.ownPartyIds.has(id))) return true;
  return actor.role === 'artist' && row.artist_contact_id !== null && scopeAllowsContact(actor.artistScope, row.artist_contact_id);
}

export const mayWriteContracts = (caps: ReadonlySet<string>): boolean => caps.has('contracts.write');
