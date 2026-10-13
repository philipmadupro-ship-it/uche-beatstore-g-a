import { describe, expect, it } from 'vitest';
import {
  buildProvenance,
  connectedAudioUrl,
  connectedRecordingPlayerTrack,
  connectionReachesAnyProject,
  connectionReachesProject,
  isCopyableType,
  isOpen,
  labelScopeReaches,
  mayAccept,
  mayChangeShare,
  shareSummary,
  sideOf,
  statusLabel,
  toConnectionView,
  toSharedSet,
  type ConnectionRow,
} from './connections';
import { listableTrackIds } from './connected-music';

const L = '10000000-0000-4000-8000-000000000001';
const A = '10000000-0000-4000-8000-000000000002';
const X = '10000000-0000-4000-8000-000000000003';
const P1 = '40000000-0000-4000-8000-000000000001';
const P2 = '40000000-0000-4000-8000-000000000002';
const C = '30000000-0000-4000-8000-000000000001';

const conn = (extra: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: 'c', label_org_id: L, artist_org_id: A, status: 'active', initiated_by: 'label', label_contact_id: C,
  share_mode: 'selected', allow_copies: false, accepted_at: null, ended_at: null, created_at: '2026-10-01', ...extra,
});

describe('sides', () => {
  it('knows which side an org is on, case-insensitively, and nothing about a third org', () => {
    expect(sideOf(conn(), L)).toBe('label');
    expect(sideOf(conn(), A.toUpperCase())).toBe('artist');
    expect(sideOf(conn(), X)).toBeNull();
  });
});

describe('who may accept, share and see', () => {
  it('the side that did NOT ask accepts, only while it is a request', () => {
    const asked = conn({ status: 'requested', initiated_by: 'label' });
    expect(mayAccept(asked, A)).toBe(true);
    expect(mayAccept(asked, L)).toBe(false);
    expect(mayAccept(asked, X)).toBe(false);
    expect(mayAccept(conn({ status: 'requested', initiated_by: 'artist' }), L)).toBe(true);
    for (const status of ['active', 'declined', 'ended'] as const) expect(mayAccept(conn({ status, initiated_by: 'label' }), A)).toBe(false);
  });

  it('only the ARTIST side changes what is shared, while the connection is open', () => {
    expect(mayChangeShare(conn(), A)).toBe(true);
    expect(mayChangeShare(conn({ status: 'requested' }), A)).toBe(true);
    expect(mayChangeShare(conn(), L)).toBe(false);
    expect(mayChangeShare(conn(), X)).toBe(false);
    expect(mayChangeShare(conn({ status: 'ended' }), A)).toBe(false);
    expect(mayChangeShare(conn({ status: 'declined' }), A)).toBe(false);
  });

  it('open means requested or active', () => {
    expect(isOpen(conn({ status: 'requested' }))).toBe(true);
    expect(isOpen(conn({ status: 'active' }))).toBe(true);
    expect(isOpen(conn({ status: 'ended' }))).toBe(false);
    expect(isOpen(conn({ status: 'declined' }))).toBe(false);
  });
});

describe('reaching a project', () => {
  it('selected: only the listed projects; all: every project of the artist org', () => {
    const shared = toSharedSet([P1.toUpperCase()]);
    expect(connectionReachesProject(conn(), shared, P1)).toBe(true);
    expect(connectionReachesProject(conn(), shared, P2)).toBe(false);
    expect(connectionReachesProject(conn({ share_mode: 'all' }), new Set(), P2)).toBe(true);
  });

  it('nothing unless the connection is ACTIVE, whatever it shares', () => {
    for (const status of ['requested', 'declined', 'ended'] as const) {
      expect(connectionReachesProject(conn({ status, share_mode: 'all' }), toSharedSet([P1]), P1), status).toBe(false);
    }
  });

  it('a track is reached through any shared project it sits in, and through none if it sits in none', () => {
    const shared = toSharedSet([P1]);
    expect(connectionReachesAnyProject(conn(), shared, [P2, P1])).toBe(true);
    expect(connectionReachesAnyProject(conn(), shared, [P2])).toBe(false);
    expect(connectionReachesAnyProject(conn(), shared, [])).toBe(false);
    expect(connectionReachesAnyProject(conn({ share_mode: 'all' }), shared, [])).toBe(false);
  });

  it('the label member’s own artist scope applies on the roster contact', () => {
    expect(labelScopeReaches(null, conn())).toBe(true);
    expect(labelScopeReaches(new Set([C]), conn())).toBe(true);
    expect(labelScopeReaches(new Set([X]), conn())).toBe(false);
    expect(labelScopeReaches(new Set(), conn())).toBe(false);
    // An active connection with no roster contact (impossible in the database) reaches nobody who is limited.
    expect(labelScopeReaches(new Set([C]), conn({ label_contact_id: null }))).toBe(false);
  });
});

describe('views', () => {
  it('each side sees the other org by name and slug only; the artist side sees the selection, the label its roster contact', () => {
    const label = toConnectionView(conn(), L, { name: 'Nova', slug: 'nova' }, [P1])!;
    expect(label).toMatchObject({ side: 'label', other: { name: 'Nova', slug: 'nova' }, rosterContactId: C, projectIds: null, initiatedByMe: true, canAccept: false });
    const artist = toConnectionView(conn({ status: 'requested' }), A, { name: 'Night Shift', slug: 'night-shift' }, [P2, P1])!;
    expect(artist).toMatchObject({ side: 'artist', rosterContactId: null, projectIds: [P1, P2], initiatedByMe: false, canAccept: true });
    expect(toConnectionView(conn(), X, { name: 'x', slug: 'x' }, [])).toBeNull();
  });

  it('never carries an org id of the other side', () => {
    const text = JSON.stringify(toConnectionView(conn(), L, { name: 'Nova', slug: 'nova' }, [P1]));
    expect(text).not.toContain(A);
    expect(text).not.toContain(L);
  });

  it('words', () => {
    expect(statusLabel({ status: 'active', initiatedByMe: true })).toBe('Connected');
    expect(statusLabel({ status: 'requested', initiatedByMe: true })).toBe('Request sent');
    expect(statusLabel({ status: 'requested', initiatedByMe: false })).toBe('Wants to connect');
    expect(shareSummary('all', 0)).toBe('Your whole catalogue');
    expect(shareSummary('selected', 0)).toBe('Nothing yet');
    expect(shareSummary('selected', 1)).toBe('1 project');
    expect(shareSummary('selected', 3)).toBe('3 projects');
  });
});

describe('provenance (D6)', () => {
  it('names the source, the time and the copier — no live reference', () => {
    const p = buildProvenance({ sourceOrgId: A, sourceTrackId: P1, copiedBy: L, now: new Date('2026-10-13T10:00:00Z') });
    expect(p).toEqual({ source_org_id: A, source_track_id: P1, copied_at: '2026-10-13T10:00:00.000Z', copied_by: L });
    expect(buildProvenance({ sourceOrgId: null, sourceTrackId: P1, copiedBy: L }).source_org_id).toBeNull();
  });
});

describe('what can be copied (D6)', () => {
  it('material, not songs', () => {
    for (const t of ['beat', 'instrumental', 'loop', 'topline']) expect(isCopyableType(t), t).toBe(true);
    for (const t of ['song', 'remix', '', null, undefined]) expect(isCopyableType(t), String(t)).toBe(false);
  });
});

describe('playing a connected recording', () => {
  it('streams same-origin from the LABEL’s audio route and carries no stored reference', () => {
    expect(connectedAudioUrl(L, P1)).toBe(`/api/org/${L}/audio/${P1}?variant=full`);
    const track = connectedRecordingPlayerTrack(L, { id: P1, title: 'Demo', type: 'song', bpm: 140, key: 'F', scale: 'minor', durationSeconds: 120, canCopy: false }, 'Nova demos');
    expect(track.audio_url).toBe(`/api/org/${L}/audio/${P1}?variant=full`);
    expect(track.preview_url).toBeNull();
    expect(track.peaks_url).toBeNull();
  });
});

describe('what a member may list (D4, their own capabilities)', () => {
  const facts = new Map<string, { requiredAudio: Set<'audio.finished' | 'audio.working'> | null }>([
    ['fin', { requiredAudio: new Set(['audio.finished']) }],
    ['wip', { requiredAudio: new Set(['audio.working']) }],
    ['both', { requiredAudio: new Set(['audio.finished', 'audio.working']) }],
    ['none', { requiredAudio: null }],
  ]);
  const ids = ['fin', 'wip', 'both', 'none', 'ghost'];

  it('marketing (finished only) lists finished recordings; an A&R lists both; unclassified and unknown tracks are out', () => {
    expect([...listableTrackIds(ids, facts, new Set(['audio.finished']))]).toEqual(['fin']);
    expect([...listableTrackIds(ids, facts, new Set(['audio.finished', 'audio.working']))].sort()).toEqual(['both', 'fin', 'wip']);
    expect([...listableTrackIds(ids, facts, new Set())]).toEqual([]);
  });
});
