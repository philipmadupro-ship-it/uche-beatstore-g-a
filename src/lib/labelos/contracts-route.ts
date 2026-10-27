/**
 * Helpers shared by the contract routes (LABEL-57): who the caller is as far
 * as contracts go, and how rows become responses. Reads go through the same
 * rule as the database policy (`contracts/access#mayReadContract`).
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { mayReadContract, readsAllContracts, type ContractActor } from './contracts/access';
import { contractView, partyName, renderContext, type ContractPartyLink, type ContractRow, type ContractView, type PartyIdentity } from './contracts/context';
import { renderClauses, type Rendered } from './contracts/render';
import type { ContractDocumentInput } from './contracts/document';
import { CONTRACT_STATUS_LABELS, PARTY_ROLE_LABELS, TEMPLATE_TYPE_LABELS } from './contracts/types';
import { identitiesOf, linkedNames, linksOf, ownPartyIds, readContractRow, type ContractReadScope } from './contracts-store';

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

// ── LABEL-58 ────────────────────────────────────────────────────────────

/** The PDF's input from what the live preview shows, so file and screen cannot differ. */
export function documentInputOf(
  row: Pick<ContractRow, 'title' | 'type' | 'status' | 'version'>,
  links: readonly ContractPartyLink[],
  identities: ReadonlyMap<string, PartyIdentity>,
  rendered: Rendered,
  generatedOn: string = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
): ContractDocumentInput {
  return {
    title: row.title,
    typeLabel: TEMPLATE_TYPE_LABELS[row.type],
    statusLabel: CONTRACT_STATUS_LABELS[row.status],
    version: row.version,
    parties: [...links]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ roleLabel: PARTY_ROLE_LABELS[l.role], name: identities.get(l.party_id) ? partyName(identities.get(l.party_id)!) : 'Unknown party' })),
    clauses: rendered.clauses,
    missing: rendered.missing,
    generatedOn,
  };
}

type OrgAccess = Extract<Awaited<ReturnType<typeof import('@/lib/auth/org-access').requireOrgModule>>, { ok: true }>;

/** One contract the caller may read, with its parties and their names; null = 404 (not there, or not theirs). */
export async function loadContractFor(access: OrgAccess, contractId: string) {
  const actor = await contractActor(access);
  const row = await readContractRow(access.admin, access.orgId, contractId);
  if (!row) return null;
  const links = (await linksOf(access.admin, access.orgId, [row.id])).get(row.id) ?? [];
  if (!mayReadContract(actor, { status: row.status, artist_contact_id: row.artist_contact_id, partyIds: links.map((l) => l.party_id) })) return null;
  const identities = await identitiesOf(access.admin, access.orgId, links.map((l) => l.party_id));
  return { actor, row, links, identities };
}
