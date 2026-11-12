import { describe, expect, it, vi } from 'vitest';
import type { AdminClient } from '@/lib/auth/ownership';
import { loadMySessions } from './my-sessions-store';
import type { SessionProject } from './my-sessions';

vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({}) }));

type Row = Record<string, unknown>;

/** A tiny in-memory PostgREST: select + in / eq / is filters, awaited like the real builder. */
function fake(tables: Record<string, Row[]>, missing: string[] = []): AdminClient {
  return {
    from(name: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let window: [number, number] | null = null;
      const q = {
        select: () => q,
        order: () => q,
        range: (from: number, to: number) => ((window = [from, to]), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        then(resolve: (v: { data: Row[] | null; error: { message: string; code?: string } | null }) => unknown) {
          if (missing.includes(name)) return resolve({ data: null, error: { message: `relation ${name}`, code: '42P01' } });
          const rows = (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
          return resolve({ data: window ? rows.slice(window[0], window[1] + 1) : rows, error: null });
        },
      };
      return q;
    },
  } as unknown as AdminClient;
}

const ME = 'me';
const O1 = 'org-1';
const O2 = 'org-2';
const proj = (id: string, orgId: string, orgName: string): SessionProject => ({ id, orgId, orgName, name: id, role: 'contributor', href: `/shared/${id}` });

const base = (): Record<string, Row[]> => ({
  project_tracks: [
    { project_id: 'p1', track_id: 't1' },
    { project_id: 'p-other', track_id: 't-other' },
  ],
  tracks: [
    { id: 't1', title: 'Midnight', org_id: O1 },
    { id: 't-other', title: 'Secret', org_id: O1 },
  ],
  parties: [
    { id: 'party-me', org_id: O1, user_id: ME, details_confirmed_by: ME, user_linked_by: 'boss' },
    { id: 'party-you', org_id: O1, user_id: 'you' },
  ],
  track_collaborators: [
    { id: 'c-mine', track_id: 't1', role: 'producer', status: 'proposed', created_by: 'boss', party_id: 'party-me' },
    { id: 'c-theirs', track_id: 't1', role: 'feature', status: 'proposed', created_by: 'boss', party_id: 'party-you' },
    { id: 'c-secret', track_id: 't-other', role: 'producer', status: 'proposed', created_by: 'boss', party_id: 'party-me' },
    { id: 'c-selfmade', track_id: 't1', role: 'mixer', status: 'proposed', created_by: ME, party_id: 'party-me' },
  ],
  split_lines: [
    { id: 'l-mine', split_sheet_id: 's1', track_id: 't1', party_id: 'party-me', signed_at: null, split_sheets: { status: 'circulated' } },
    { id: 'l-draft', split_sheet_id: 's2', track_id: 't1', party_id: 'party-me', signed_at: null, split_sheets: { status: 'draft' } },
    { id: 'l-theirs', split_sheet_id: 's1', track_id: 't1', party_id: 'party-you', signed_at: null, split_sheets: { status: 'circulated' } },
  ],
  contract_parties: [{ contract_id: 'k1', party_id: 'party-me', org_id: O1 }],
  contracts: [{ id: 'k1', org_id: O1, title: 'Producer agreement', status: 'sent', track_id: 't1', sent_document_sha256: 'a'.repeat(64) }],
  contract_signatures: [],
  organizations: [{ id: O1, kind: 'label' }, { id: O2, kind: 'label' }],
  org_entitlements: [],
});

const asksOf = (s: Awaited<ReturnType<typeof loadMySessions>>) => s.flatMap((o) => o.projects.flatMap((p) => p.asks.map((a) => a.key)));

describe('loadMySessions', () => {
  it('lists the caller’s own credit, split line and contract on their project — and nothing else', async () => {
    const s = await loadMySessions(ME, [proj('p1', O1, 'Night Shift')], fake(base()));
    expect(asksOf(s).sort()).toEqual(['contract:k1', 'credit:c-mine', 'split:l-mine']);
  });

  it('never lists another person’s credit or line, a self-proposed credit, a draft sheet, or a song outside their projects', async () => {
    const keys = asksOf(await loadMySessions(ME, [proj('p1', O1, 'Night Shift')], fake(base())));
    for (const bad of ['c-theirs', 'c-secret', 'c-selfmade', 'l-draft', 'l-theirs']) expect(keys.join()).not.toContain(bad);
  });

  it('a song in a project they are not on yields nothing, even with their own credit on it', async () => {
    const s = await loadMySessions(ME, [proj('p-nope', O1, 'Night Shift')], fake(base()));
    expect(asksOf(s)).toEqual([]);
    expect(s.flatMap((o) => o.projects.map((p) => p.id))).toEqual(['p-nope']);
  });

  it('a track of another org is never matched to a project of this org', async () => {
    const t = base();
    t.tracks[0].org_id = O2;
    expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'Night Shift')], fake(t)))).toEqual([]);
  });

  it('groups several orgs', async () => {
    const t = base();
    t.project_tracks.push({ project_id: 'p2', track_id: 't2' });
    t.tracks.push({ id: 't2', title: 'Two', org_id: O2 });
    t.parties.push({ id: 'party-me-2', org_id: O2, user_id: ME });
    t.track_collaborators.push({ id: 'c2', track_id: 't2', role: 'vocalist', status: 'proposed', created_by: 'x', party_id: 'party-me-2' });
    const s = await loadMySessions(ME, [proj('p1', O1, 'Night Shift'), proj('p2', O2, 'Label B')], fake(t));
    expect(s.map((o) => o.orgId).sort()).toEqual([O1, O2]);
    expect(asksOf(s)).toContain('credit:c2');
  });

  it('a song in several of the person’s projects is ONE ask, filed under its first project', async () => {
    const t = base();
    t.project_tracks.push({ project_id: 'p0', track_id: 't1' });
    const s = await loadMySessions(ME, [proj('p1', O1, 'N'), proj('p0', O1, 'N')], fake(t));
    expect(asksOf(s).filter((k) => k.startsWith('credit'))).toEqual(['credit:c-mine']);
    expect(s[0].askCount).toBe(3);
    expect(s[0].projects.find((p) => p.asks.length)?.id).toBe('p0');
  });

  it('contracts: omitted for an org whose licence has no contracts module, or with no frozen sent copy', async () => {
    const t = base();
    t.org_entitlements.push({ org_id: O1, modules: ['catalogue'], max_seats: null, max_artists: null, setup_done: true });
    expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'N')], fake(t))).join()).not.toContain('contract');
    const t2 = base();
    t2.contracts[0].sent_document_sha256 = null;
    expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'N')], fake(t2))).join()).not.toContain('contract');
  });

  it('a project with hundreds of songs is read in chunks and pages, and the ask is still found', async () => {
    const t = base();
    for (let i = 0; i < 450; i++) {
      t.project_tracks.push({ project_id: 'p1', track_id: `bulk-${i}` });
      t.tracks.push({ id: `bulk-${i}`, title: `Bulk ${i}`, org_id: O1 });
    }
    expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'N')], fake(t))).sort()).toEqual(['contract:k1', 'credit:c-mine', 'split:l-mine']);
  });

  it('a signature on the current document clears the contract ask', async () => {
    const t = base();
    t.contract_signatures.push({ contract_id: 'k1', party_id: 'party-me', document_sha256: 'a'.repeat(64) });
    expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'N')], fake(t))).join()).not.toContain('contract');
  });

  it('no contract ask where in-app signing would refuse: unconfirmed details, a self-made link, an unknown linker (maySignAs)', async () => {
    for (const patch of [{ details_confirmed_by: null }, { user_linked_by: ME }, { user_linked_by: null }]) {
      const t = base();
      Object.assign(t.parties[0], patch);
      expect(asksOf(await loadMySessions(ME, [proj('p1', O1, 'N')], fake(t))).join()).not.toContain('contract');
    }
  });

  it('degrades where the contract tables are not applied: credits and splits remain, no error', async () => {
    const s = await loadMySessions(ME, [proj('p1', O1, 'N')], fake(base(), ['contract_parties', 'contracts', 'contract_signatures']));
    expect(asksOf(s).sort()).toEqual(['credit:c-mine', 'split:l-mine']);
  });

  it('degrades when credits and splits are missing too: the project list still comes back', async () => {
    const s = await loadMySessions(ME, [proj('p1', O1, 'N')], fake(base(), ['track_collaborators', 'split_lines', 'contract_parties']));
    expect(asksOf(s)).toEqual([]);
    expect(s).toHaveLength(1);
  });

  it('a person with no memberships has no sessions', async () => {
    expect(await loadMySessions(ME, [], fake(base()))).toEqual([]);
  });
});
