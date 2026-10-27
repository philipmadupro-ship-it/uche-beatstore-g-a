/**
 * Builds a contract's render context and its JSON view (LABEL-57). Pure: the
 * store gathers rows, this decides what a document says and what each kind of
 * reader receives, field by field (a row is never spread into a response).
 */
import type { BuiltinKey } from './merge-fields';
import type { RenderContext, RenderParty } from './render';
import type { PartyRole } from './types';
import type { ContractStatus, TemplateTypeId } from './types';
import type { TemplateClause } from './templates';

export type PartyIdentity = { id: string; display_name: string; legal_name: string | null; address: string | null };

export type ContractRow = {
  id: string;
  type: TemplateTypeId;
  title: string;
  status: ContractStatus;
  template_id: string | null;
  template_source: string;
  template_version: number;
  clauses: TemplateClause[];
  artist_contact_id: string | null;
  track_id: string | null;
  release_id: string | null;
  effective_date: string | null;
  term_months: number | null;
  territories: string[] | null;
  fields: Record<string, string>;
  internal_note: string | null;
  version: number;
  created_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractPartyLink = { party_id: string; role: PartyRole; position: number };

export function formatDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatTerm(months: number | null): string | null {
  if (months === null || !Number.isInteger(months) || months < 1) return null;
  if (months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? '' : 's'}`;
  }
  return `${months} month${months === 1 ? '' : 's'}`;
}

export function formatTerritories(codes: readonly string[] | null): string | null {
  if (!codes || codes.length === 0) return null;
  if (codes.length === 1 && codes[0] === 'WW') return 'Worldwide';
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    names = null;
  }
  return codes.map((c) => names?.of(c) ?? c).join(', ');
}

export function partyName(p: PartyIdentity): string {
  return (p.legal_name?.trim() || p.display_name).trim();
}

export type ContextInput = {
  row: Pick<ContractRow, 'title' | 'effective_date' | 'term_months' | 'territories' | 'fields'>;
  links: readonly ContractPartyLink[];
  identities: ReadonlyMap<string, PartyIdentity>;
  artistName: string | null;
  songTitle: string | null;
  releaseTitle: string | null;
};

export function renderContext(input: ContextInput): RenderContext {
  const builtins: Partial<Record<BuiltinKey, string>> = { 'contract.title': input.row.title };
  const set = (k: BuiltinKey, v: string | null) => {
    if (v) builtins[k] = v;
  };
  set('contract.effective_date', formatDate(input.row.effective_date));
  set('contract.term', formatTerm(input.row.term_months));
  set('contract.territory', formatTerritories(input.row.territories));
  set('artist.name', input.artistName);
  set('song.title', input.songTitle);
  set('release.title', input.releaseTitle);

  const parties: Partial<Record<PartyRole, RenderParty[]>> = {};
  for (const link of [...input.links].sort((a, b) => a.position - b.position)) {
    const p = input.identities.get(link.party_id);
    if (!p) continue;
    (parties[link.role] ??= []).push({ name: partyName(p), address: p.address });
  }
  return { builtins, parties, fields: input.row.fields };
}

export type ViewParty = { party_id: string; role: PartyRole; name: string };

export type ContractView = {
  id: string;
  type: TemplateTypeId;
  title: string;
  status: ContractStatus;
  artist_contact_id: string | null;
  track_id: string | null;
  release_id: string | null;
  effective_date: string | null;
  term_months: number | null;
  territories: string[] | null;
  fields: Record<string, string>;
  parties: ViewParty[];
  version: number;
  template_version: number;
  created_at: string;
  updated_at: string;
  /** Business side only. */
  internal_note?: string | null;
  template_source?: string;
  void_reason?: string | null;
  voided_at?: string | null;
};

/** One response shape, built field by field. `business` = the reader holds contracts.read. */
export function contractView(row: ContractRow, links: readonly ContractPartyLink[], identities: ReadonlyMap<string, PartyIdentity>, business: boolean): ContractView {
  const view: ContractView = {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    artist_contact_id: row.artist_contact_id,
    track_id: row.track_id,
    release_id: row.release_id,
    effective_date: row.effective_date,
    term_months: row.term_months,
    territories: row.territories,
    fields: row.fields,
    parties: links
      .map((l) => ({ party_id: l.party_id, role: l.role, name: identities.get(l.party_id) ? partyName(identities.get(l.party_id)!) : 'Unknown party', position: l.position }))
      .sort((a, b) => a.position - b.position)
      .map(({ party_id, role, name }) => ({ party_id, role, name })),
    version: row.version,
    template_version: row.template_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (business) {
    view.internal_note = row.internal_note;
    view.template_source = row.template_source;
    view.void_reason = row.void_reason;
    view.voided_at = row.voided_at;
  }
  return view;
}
