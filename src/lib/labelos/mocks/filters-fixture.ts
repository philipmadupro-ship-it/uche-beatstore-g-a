/**
 * The catalogue the LABEL-37 tests run the seven 08 §A2 queries against.
 *
 *   Label L — roster artists Nova (C1, project LP1) and Kilo (C2, Inbox LP2).
 *   Parties: PX "Producer X" (an account, UX, behind it), PB "Bea" (featured).
 *
 *   S1 Home      Nova  in development  no cover  PX producer + PB feature; splits complete
 *   S2 Away      Kilo  inbox           no cover  no credits, no sheets; a DEMO made 12 Sept; legal asked, unanswered
 *   S3 Selected  Nova  selected        cover     PB feature + PX mixer; on a release; both splits complete; legal approved
 *   S4 Tasked    Nova  in review       no cover  uploaded by UX; no credits, no sheets
 *
 * Members: OWN (owner), AR (A&R, whole org), AR_K (A&R limited to Kilo),
 * MKT (marketing: catalog.read + finished audio), PROD (producer function:
 * rights.read.own_line only), ADM (admin), STRANGER (nothing).
 */
import type { MemoryDb } from './memory-db';

export const L = '10000000-0000-4000-8000-000000000001';
export const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const OWN = u(1), AR = u(2), AR_K = u(3), MKT = u(4), PROD = u(5), ADM = u(6), STRANGER = u(7), UX = u(20);
export const C1 = '30000000-0000-4000-8000-0000000000c1';
export const C2 = '30000000-0000-4000-8000-0000000000c2';
export const LP1 = '40000000-0000-4000-8000-0000000000a1';
export const LP2 = '40000000-0000-4000-8000-0000000000a2';
const t = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const S1 = t(1), S2 = t(2), S3 = t(3), S4 = t(4), D1 = t(5), XS = t(9);
export const PX = '80000000-0000-4000-8000-000000000001';
export const PB = '80000000-0000-4000-8000-000000000002';
export const R1 = '70000000-0000-4000-8000-000000000001';
const sheet = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const member = (user: string, role: string, functions: string[] = [], scope = 'org') => ({ org_id: L, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });
const song = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, org_id: L, user_id: null, type: 'song', title, song_stage: 'in_development', cover_url: null, bpm: 120, key: 'F minor', isrc: null,
  created_at: '2026-10-01T10:00:00Z', created_by: OWN, ...over,
});
const credit = (n: number, track: string, party: string, role: string) => ({ id: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, org_id: L, track_id: track, party_id: party, role, status: 'confirmed', scope: 'recording', name: 'x' });
const line = (n: number, sheetId: string, party: string, share: number) => ({ id: `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, org_id: L, split_sheet_id: sheetId, party_id: party, role: 'writer', share, signed_at: null });

export function filtersDb(): MemoryDb {
  return {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null }, { id: L2, kind: 'label', deleted_at: null }],
      org_members: [
        member(OWN, 'owner'),
        member(ADM, 'admin'),
        member(AR, 'member', ['a_and_r']),
        member(AR_K, 'member', ['a_and_r'], 'artists'),
        member(MKT, 'member', ['marketing']),
        member(PROD, 'member', ['producer']),
      ],
      member_artist_scopes: [{ org_id: L, user_id: AR_K, contact_id: C2 }],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist', email: null, label: null, role: null },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist', email: null, label: null, role: null },
      ],
      projects: [
        { id: LP1, org_id: L, user_id: null, name: 'Nova EP', description: null, inbox_for_contact_id: null },
        { id: LP2, org_id: L, user_id: null, name: 'Inbox Kilo', description: null, inbox_for_contact_id: C2 },
      ],
      project_contacts: [{ project_id: LP1, contact_id: C1, user_id: null }],
      project_tracks: [
        { project_id: LP1, track_id: S1, position: 0 }, { project_id: LP1, track_id: S3, position: 1 }, { project_id: LP1, track_id: S4, position: 2 },
        { project_id: LP2, track_id: S2, position: 0 }, { project_id: LP2, track_id: D1, position: 1 },
      ],
      project_members: [],
      tracks: [
        song(S1, 'Home', { created_at: '2026-10-01T10:00:00Z' }),
        song(S2, 'Away', { song_stage: 'inbox', created_at: '2026-10-02T10:00:00Z' }),
        song(S3, 'Selected', { song_stage: 'selected', cover_url: 'https://cdn.test/s3.jpg', created_at: '2026-10-03T10:00:00Z' }),
        song(S4, 'Tasked', { song_stage: 'in_review', created_at: '2026-10-04T10:00:00Z', created_by: UX }),
        { id: D1, org_id: L, user_id: null, type: 'instrumental', title: 'Away demo', song_stage: null, cover_url: null, bpm: null, key: null, isrc: null, created_at: '2026-09-12T09:00:00Z', created_by: OWN },
        song(XS, 'Other org song', { org_id: L2 }),
      ],
      track_links: [{ from_track_id: S2, to_track_id: D1, relation: 'demo' }],
      song_beats: [],
      releases: [{ id: R1, org_id: L, project_id: LP1, contact_id: C1, title: 'Nova EP', type: 'ep', state: 'draft', target_date: '2026-12-01', release_date: null, delivered_at: null, created_at: '2026-10-05T00:00:00Z' }],
      release_items: [{ id: 'd0000000-0000-4000-8000-000000000001', org_id: L, release_id: R1, position: 1, song_track_id: S3, master_track_id: S3 }],
      parties: [
        { id: PX, org_id: L, display_name: 'Producer X', legal_name: null, ipi: null, kind: 'person', user_id: UX },
        { id: PB, org_id: L, display_name: 'Bea', legal_name: null, ipi: null, kind: 'person', user_id: null },
      ],
      track_collaborators: [
        credit(1, S1, PX, 'producer'), credit(2, S1, PB, 'feature'),
        credit(3, S3, PB, 'feature'), credit(4, S3, PX, 'mixer'),
      ],
      split_sheets: [
        { id: sheet(1), org_id: L, track_id: S1, kind: 'composition', version: 1, status: 'signed' },
        { id: sheet(2), org_id: L, track_id: S3, kind: 'composition', version: 1, status: 'signed' },
        { id: sheet(3), org_id: L, track_id: S3, kind: 'master', version: 1, status: 'signed' },
      ],
      split_lines: [
        line(1, sheet(1), PX, 60), line(2, sheet(1), PB, 40),
        line(3, sheet(2), PX, 50), line(4, sheet(2), PB, 50),
        line(5, sheet(3), PX, 100),
      ],
      approvals: [
        { id: 'e0000000-0000-4000-8000-000000000001', org_id: L, song_id: S2, release_id: null, gate: 'legal', decision: 'requested', note: null, actor_id: OWN, approver_id: ADM, request_id: null, subject_snapshot: {}, created_at: '2026-10-05T10:00:00Z' },
        { id: 'e0000000-0000-4000-8000-000000000002', org_id: L, song_id: S3, release_id: null, gate: 'legal', decision: 'requested', note: null, actor_id: OWN, approver_id: ADM, request_id: null, subject_snapshot: {}, created_at: '2026-10-05T10:00:00Z' },
        { id: 'e0000000-0000-4000-8000-000000000003', org_id: L, song_id: S3, release_id: null, gate: 'legal', decision: 'approved', note: null, actor_id: ADM, approver_id: null, request_id: null, subject_snapshot: {}, created_at: '2026-10-06T10:00:00Z' },
      ],
      tasks: [],
      org_saved_views: [],
      activity_events: [],
    },
  };
}
