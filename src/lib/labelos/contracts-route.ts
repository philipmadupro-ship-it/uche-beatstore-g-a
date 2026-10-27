/**
 * Helpers shared by the contract routes (LABEL-57): who the caller is as far
 * as contracts go, and how rows become responses. Reads go through the same
 * rule as the database policy (`contracts/access#mayReadContract`).
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { mayReadContract, readsAllContracts, type ContractActor } from './contracts/access';
import { contractView, renderContext, type ContractPartyLink, type ContractRow, type ContractView, type PartyIdentity } from './contracts/context';
import { renderClauses, type Rendered } from './contracts/render';
import { identitiesOf, linkedNames, linksOf, ownPartyIds, type ContractReadScope } from './contracts-store';

export async function contractActor(access: Pick<OrgAccessOk, 'admin' | 'orgId' | 'userId' | 'role' | 'capabilities' | 'artistScope'>): Promise<ContractActor> {
  return {
    role: access.role,
    capabilities: access.capabilities,
    artistScope: access.artistScope,
    ownPartyIds: await ownPartyIds(access.admin, access.orgId, access.userId),
  };
}

export type LoadedContracts = {
  rows: ContractRow[];
  links: Map<string, ContractPartyLink[]>;
  identities: Map<string, PartyIdentity>;
};

/** Keep the rows this actor may read, with their parties and party names. */
export async function visibleContracts(admin: AdminClient, org: string, actor: ContractActor, rows: ContractRow[]): Promise<LoadedContracts> {
  const links = await linksOf(admin, org, rows.map((r) => r.id));
  const kept = rows.filter((r) => mayReadContract(actor, { status: r.status, artist_contact_id: r.artist_contact_id, partyIds: (links.get(r.id) ?? []).map((l) => l.party_id) }));
  const partyIds = [...new Set(kept.flatMap((r) => (links.get(r.id) ?? []).map((l) => l.party_id)))];
  const identities = await identitiesOf(admin, org, partyIds);
  return { rows: kept, links, identities };
}

export function viewsOf(loaded: LoadedContracts, actor: ContractActor): ContractView[] {
  const business = readsAllContracts(actor);
  return loaded.rows.map((r) => contractView(r, loaded.links.get(r.id) ?? [], loaded.identities, business));
}

/** The contract's text with its values filled in. */
export async function documentOf(admin: AdminClient, org: string, row: ContractRow, links: readonly ContractPartyLink[], identities: ReadonlyMap<string, PartyIdentity>): Promise<Rendered> {
  const names = await linkedNames(admin, org, row);
  return renderClauses(row.clauses, renderContext({ row, links, identities, ...names }));
}

/** The narrowest read that still contains everything `mayReadContract` would let this actor see. */
export function readScopeFor(actor: ContractActor): ContractReadScope {
  if (readsAllContracts(actor)) {
    return actor.artistScope === null ? { kind: 'all' } : { kind: 'artists', contactIds: [...actor.artistScope], sentOnly: false, partyIds: [] };
  }
  return { kind: 'own', contactIds: actor.role === 'artist' && actor.artistScope ? [...actor.artistScope] : [], partyIds: [...actor.ownPartyIds] };
}
