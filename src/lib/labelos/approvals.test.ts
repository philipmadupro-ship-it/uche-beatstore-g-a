import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import { canTransition, parseShare, validateSheet, type SplitLineInput } from './splits';
import {
  GATES,
  SNAPSHOT_PARTS,
  approvalChip,
  approvalIsStale,
  buildSnapshot,
  changedParts,
  currentByGate,
  currentDecision,
  gateAppliesTo,
  gateCapability,
  isStale,
  planDecide,
  planRequest,
  songSnapshotFacts,
  type Actor,
  type ApprovalRow,
  type CurrentApproval,
  type Gate,
} from './approvals';

const ME = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const SONG = 'e0000000-0000-4000-8000-000000000001';

let n = 0;
function row(over: Partial<ApprovalRow> & Pick<ApprovalRow, 'decision'>): ApprovalRow {
  n += 1;
  return {
    id: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    org_id: 'b0000000-0000-4000-8000-000000000001',
    song_id: SONG,
    release_id: null,
    gate: 'legal',
    note: null,
    actor_id: OTHER,
    approver_id: null,
    request_id: null,
    subject_snapshot: {},
    created_at: `2026-10-0${Math.min(9, n)}T10:00:00Z`,
    ...over,
  };
}

const actor = (role: string, fns: string[] = [], id = ME): Actor => ({ id, role, capabilities: capabilitiesFor('label', role, fns) });
const NONE: CurrentApproval = currentDecision([]);

describe('currentDecision', () => {
  it('is none without rows', () => {
    expect(NONE).toEqual({ status: 'none', latest: null, decided: null, pending: null });
  });

  it('the latest row is current, whatever order the rows arrive in', () => {
    const req = row({ decision: 'requested', created_at: '2026-10-01T10:00:00Z' });
    const ok = row({ decision: 'approved', created_at: '2026-10-02T10:00:00Z', request_id: req.id });
    expect(currentDecision([req, ok]).status).toBe('approved');
    expect(currentDecision([ok, req]).status).toBe('approved');
    expect(currentDecision([ok, req]).pending).toBeNull();
  });

  it('a request after an approval re-opens the gate but keeps the earlier decision visible', () => {
    const ok = row({ decision: 'approved', created_at: '2026-10-02T10:00:00Z' });
    const again = row({ decision: 'requested', created_at: '2026-10-03T10:00:00Z' });
    const c = currentDecision([ok, again]);
    expect(c.status).toBe('requested');
    expect(c.pending?.id).toBe(again.id);
    expect(c.decided?.id).toBe(ok.id);
  });

  it('changes requested is current until the next request or decision', () => {
    const no = row({ decision: 'changes_requested', note: 'fix IPI', created_at: '2026-10-02T10:00:00Z' });
    expect(currentDecision([no]).status).toBe('changes_requested');
    expect(currentDecision([no, row({ decision: 'approved', created_at: '2026-10-04T10:00:00Z' })]).status).toBe('approved');
  });

  it('ties on the timestamp go to the later row', () => {
    const at = '2026-10-05T10:00:00Z';
    expect(currentDecision([row({ decision: 'requested', created_at: at }), row({ decision: 'approved', created_at: at })]).status).toBe('approved');
  });

  it('groups per gate and never mixes them', () => {
    const rows = [row({ decision: 'approved', gate: 'legal' }), row({ decision: 'requested', gate: 'artwork', song_id: null })];
    const by = currentByGate(rows);
    expect(by.get('legal')?.status).toBe('approved');
    expect(by.get('artwork')?.status).toBe('requested');
    expect(by.get('master')?.status).toBe('none');
    expect([...by.keys()]).toEqual([...GATES]);
  });
});

describe('snapshot + isStale', () => {
  const credit = { id: 'c1', status: 'confirmed', party_id: 'p1' };
  const sheet = (id: string, version: number, status: string) => ({ id, kind: 'composition', version, status });

  it('builds only the parts a gate covers, in a canonical order', () => {
    const facts = { songs: [songSnapshotFacts('s1', [], [])], artworkAssetId: 'a1', items: [{ songId: 's1', masterId: 'm1' }], release: { title: 'EP' } };
    for (const gate of GATES) expect(Object.keys(buildSnapshot(gate, facts).parts).sort()).toEqual([...SNAPSHOT_PARTS[gate]].sort());
    const a = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('x', 1, 'signed'), sheet('y', 1, 'circulated')], [credit, { ...credit, id: 'c0' }])] });
    const b = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('y', 1, 'circulated'), sheet('x', 1, 'signed')], [{ ...credit, id: 'c0' }, credit])] });
    expect(a).toEqual(b);
  });

  it('is not stale when nothing moved, and a reordered row is not a change', () => {
    const snap = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('x', 1, 'circulated')], [credit])] });
    expect(isStale(JSON.parse(JSON.stringify(snap)), snap)).toBe(false);
  });

  // ── The acceptance criterion, with LABEL-28's split model ─────────────
  describe('changing a split after approval makes the approval stale', () => {
    const units = (s: string) => parseShare(s)!;
    const lines = (a: string, b: string): SplitLineInput[] => [
      { partyId: 'pa', role: 'writer', units: units(a) },
      { partyId: 'pb', role: 'writer', units: units(b) },
    ];

    it('a new circulated version (the old one superseded) differs from what was approved', () => {
      // v1 is valid and circulated…
      expect(validateSheet('composition', lines('60', '40')).ok).toBe(true);
      expect(canTransition('draft', 'circulated')).toBe(true);
      const atApproval = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed')], [credit])] });
      const approved = row({ decision: 'approved', subject_snapshot: atApproval });

      // …nothing changed: still good.
      expect(approvalIsStale(currentDecision([approved]), atApproval)).toBe(false);

      // …the producer renegotiates 50/50: a new version is circulated, v1 is superseded.
      expect(validateSheet('composition', lines('50', '50')).ok).toBe(true);
      expect(canTransition('signed', 'superseded')).toBe(true);
      const now = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'superseded'), sheet('v2', 2, 'circulated')], [credit])] });
      expect(isStale(approved.subject_snapshot, now)).toBe(true);
      expect(approvalIsStale(currentDecision([approved]), now)).toBe(true);
      expect(changedParts(approved.subject_snapshot, now)).toEqual(['songs']);
    });

    it('a draft being edited is not what was approved, so it changes nothing', () => {
      const at = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed')], [credit])] });
      const withDraft = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed'), sheet('v2', 2, 'draft')], [credit])] });
      expect(isStale(at, withDraft)).toBe(false);
    });

    it('a credit disputed, or a new credit, after approval is stale too', () => {
      const at = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed')], [credit])] });
      const disputed = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed')], [{ ...credit, status: 'disputed' }])] });
      const added = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [sheet('v1', 1, 'signed')], [credit, { id: 'c2', status: 'proposed', party_id: null }])] });
      expect(isStale(at, disputed)).toBe(true);
      expect(isStale(at, added)).toBe(true);
    });
  });

  it('replacing the artwork file stales an artwork approval; other facts do not', () => {
    const at = buildSnapshot('artwork', { artworkAssetId: 'a1', items: [{ songId: 's1', masterId: 'm1' }] });
    expect(isStale(at, buildSnapshot('artwork', { artworkAssetId: 'a2' }))).toBe(true);
    expect(isStale(at, buildSnapshot('artwork', { artworkAssetId: 'a1', items: [] }))).toBe(false);
    expect(isStale(at, buildSnapshot('artwork', { artworkAssetId: null }))).toBe(true);
  });

  it('a reordered tracklist stales master; marketing has nothing underneath it to go stale', () => {
    const a = buildSnapshot('master', { items: [{ songId: 's1', masterId: 'm1' }, { songId: 's2', masterId: 'm2' }] });
    const b = buildSnapshot('master', { items: [{ songId: 's2', masterId: 'm2' }, { songId: 's1', masterId: 'm1' }] });
    expect(isStale(a, b)).toBe(true);
    expect(isStale(buildSnapshot('marketing', {}), buildSnapshot('marketing', { artworkAssetId: 'x', items: [{ songId: 's1', masterId: 'm1' }] }))).toBe(false);
  });

  it('metadata covers the release fields and the tracklist', () => {
    const at = buildSnapshot('metadata', { items: [], release: { title: 'EP', upc: '123456789012' } });
    expect(isStale(at, buildSnapshot('metadata', { items: [], release: { upc: '123456789012', title: 'EP' } }))).toBe(false);
    expect(isStale(at, buildSnapshot('metadata', { items: [], release: { title: 'EP', upc: '123456789013' } }))).toBe(true);
  });

  it('metadata also covers what each track carries to a distributor: ISRC, explicit flag, version title (09 §4)', () => {
    const base = { songId: 's1', isrc: 'USRC17607839', explicit: false, versionTitle: null as string | null };
    const at = buildSnapshot('metadata', { items: [{ songId: 's1', masterId: 'm1' }], release: { title: 'EP' }, details: [base] });
    expect(isStale(at, buildSnapshot('metadata', { items: [{ songId: 's1', masterId: 'm1' }], release: { title: 'EP' }, details: [{ ...base }] }))).toBe(false);
    for (const change of [{ isrc: 'USRC17607840' }, { isrc: null }, { explicit: true }, { versionTitle: 'Radio edit' }]) {
      const now = buildSnapshot('metadata', { items: [{ songId: 's1', masterId: 'm1' }], release: { title: 'EP' }, details: [{ ...base, ...change }] });
      expect(isStale(at, now), JSON.stringify(change)).toBe(true);
      expect(changedParts(at, now)).toEqual(['details']);
    }
    // A snapshot stored before `details` existed cannot vouch for the tracks' metadata.
    const legacy = { v: 1, gate: 'metadata', parts: { items: [{ songId: 's1', masterId: 'm1' }], release: { title: 'EP' } } };
    expect(isStale(legacy, at)).toBe(true);
    // The master gate does not care about metadata.
    const m1 = buildSnapshot('master', { items: [{ songId: 's1', masterId: 'm1' }], details: [base] });
    const m2 = buildSnapshot('master', { items: [{ songId: 's1', masterId: 'm1' }], details: [{ ...base, isrc: null }] });
    expect(isStale(m1, m2)).toBe(false);
  });

  it('a snapshot that cannot be read vouches for nothing: null, wrong version, another gate', () => {
    const now = buildSnapshot('legal', { songs: [] });
    expect(isStale(null, now)).toBe(true);
    expect(isStale({}, now)).toBe(true);
    expect(isStale({ v: 2, gate: 'legal', parts: { songs: [] } }, now)).toBe(true);
    expect(isStale(buildSnapshot('artwork', { artworkAssetId: null }), now)).toBe(true);
  });

  it('only an approval can be stale', () => {
    const now = buildSnapshot('legal', { songs: [songSnapshotFacts('s1', [{ id: 'v2', kind: 'composition', version: 2, status: 'circulated' }], [])] });
    for (const decision of ['requested', 'changes_requested'] as const) {
      expect(approvalIsStale(currentDecision([row({ decision, subject_snapshot: {} })]), now)).toBe(false);
    }
    expect(approvalIsStale(NONE, now)).toBe(false);
  });
});

describe('planRequest', () => {
  const base = { kind: 'song' as const, gate: 'legal', actor: actor('member', ['a_and_r']), approverId: OTHER, approverMayDecide: true, current: NONE };

  it('a song is asked for legal only; a release for any gate', () => {
    expect(planRequest(base).ok).toBe(true);
    expect(gateAppliesTo('song', 'artwork')).toBe(false);
    expect(planRequest({ ...base, gate: 'artwork' })).toMatchObject({ ok: false, status: 400, code: 'bad_gate' });
    expect(planRequest({ ...base, kind: 'release', gate: 'artwork' }).ok).toBe(true);
    expect(planRequest({ ...base, gate: 'nope' })).toMatchObject({ ok: false, code: 'bad_gate' });
  });

  it('needs release.write, rights.write or the gate capability', () => {
    expect(planRequest({ ...base, actor: actor('member', ['marketing']) })).toMatchObject({ ok: false, status: 403 });
    expect(planRequest({ ...base, kind: 'release', gate: 'artwork', actor: actor('member', ['marketing']) }).ok).toBe(true);
    expect(planRequest({ ...base, actor: actor('member', ['legal']) }).ok).toBe(true);
    expect(planRequest({ ...base, actor: actor('artist') })).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a second request while one is waiting, and an approver who cannot decide', () => {
    const waiting = currentDecision([row({ decision: 'requested' })]);
    expect(planRequest({ ...base, current: waiting })).toMatchObject({ ok: false, status: 409, code: 'already_requested' });
    expect(planRequest({ ...base, approverMayDecide: false })).toMatchObject({ ok: false, status: 422, code: 'approver_cannot_decide' });
  });

  it('a member cannot ask themselves; an owner or admin can', () => {
    expect(planRequest({ ...base, approverId: ME })).toMatchObject({ ok: false, code: 'ask_someone_else' });
    expect(planRequest({ ...base, actor: actor('owner'), approverId: ME }).ok).toBe(true);
    expect(planRequest({ ...base, actor: actor('admin'), approverId: ME }).ok).toBe(true);
  });

  it('a request after an approval or a change request is allowed (it re-opens the gate)', () => {
    expect(planRequest({ ...base, current: currentDecision([row({ decision: 'approved' })]) }).ok).toBe(true);
    expect(planRequest({ ...base, current: currentDecision([row({ decision: 'changes_requested', note: 'x' })]) }).ok).toBe(true);
  });
});

describe('planDecide', () => {
  const legal = actor('member', ['legal']);
  const base = { kind: 'song' as const, gate: 'legal', decision: 'approved', actor: legal, current: NONE, stale: false, legalReady: true };
  const ownRequest = currentDecision([row({ decision: 'requested', actor_id: ME })]);
  const theirRequest = currentDecision([row({ decision: 'requested', actor_id: OTHER })]);

  it('needs the gate capability: 403 before anything else', () => {
    expect(planDecide({ ...base, actor: actor('member', ['a_and_r']), decision: 'nonsense' })).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    expect(planDecide({ ...base, actor: actor('member', ['marketing']) })).toMatchObject({ ok: false, status: 403 });
    expect(planDecide({ ...base, actor: actor('artist') })).toMatchObject({ ok: false, status: 403 });
  });

  it('every gate is decided by its own capability, and by no other', () => {
    for (const gate of GATES) {
      const need = gateCapability(gate);
      const holders = (['owner', 'admin'] as const).map((r) => actor(r));
      for (const h of holders) expect(h.capabilities.has(need)).toBe(true);
      const kind = gate === 'legal' ? 'song' : 'release';
      const without = { id: ME, role: 'member', capabilities: new Set(['catalog.read', 'release.write'].filter((c) => c !== need)) as ReadonlySet<string> };
      expect(planDecide({ ...base, kind, gate, actor: without, legalReady: true })).toMatchObject({ ok: false, status: 403 });
      expect(planDecide({ ...base, kind, gate, actor: { ...without, capabilities: new Set([need]) }, legalReady: true }).ok).toBe(true);
    }
  });

  it('a requester cannot approve their own request', () => {
    expect(planDecide({ ...base, current: ownRequest })).toMatchObject({ ok: false, status: 403, code: 'self_approval' });
  });

  it('… unless they are owner or admin', () => {
    expect(planDecide({ ...base, actor: actor('owner'), current: ownRequest }).ok).toBe(true);
    expect(planDecide({ ...base, actor: actor('admin'), current: ownRequest }).ok).toBe(true);
  });

  it('… and anyone else may approve it, linking the request they answer', () => {
    const r = planDecide({ ...base, current: theirRequest });
    expect(r).toMatchObject({ ok: true, requestId: theirRequest.pending!.id });
  });

  it('a requester may decline their own request (changes requested) with a note', () => {
    expect(planDecide({ ...base, decision: 'changes_requested', note: 'withdrawn, wrong version', current: ownRequest }).ok).toBe(true);
  });

  it('changes requested needs a note; a note has a ceiling', () => {
    expect(planDecide({ ...base, decision: 'changes_requested', note: '   ' })).toMatchObject({ ok: false, status: 400, code: 'note_required' });
    expect(planDecide({ ...base, decision: 'changes_requested', note: 'Add Nova’s IPI' }).ok).toBe(true);
    expect(planDecide({ ...base, note: 'x'.repeat(2001) })).toMatchObject({ ok: false, code: 'note_too_long' });
    expect(planDecide({ ...base, decision: 'maybe' })).toMatchObject({ ok: false, code: 'bad_decision' });
  });

  it('legal is approved only while readiness has no blockers; changes can always be requested', () => {
    expect(planDecide({ ...base, legalReady: false, legalBlockers: 2 })).toMatchObject({ ok: false, status: 422, code: 'legal_blockers' });
    expect(planDecide({ ...base, legalReady: false, legalBlockers: 1 })).toMatchObject({ error: expect.stringContaining('1 blocker;') });
    expect(planDecide({ ...base, legalReady: false, decision: 'changes_requested', note: 'blockers' }).ok).toBe(true);
    // The other gates never look at readiness.
    expect(planDecide({ ...base, kind: 'release', gate: 'marketing', actor: actor('owner'), legalReady: false }).ok).toBe(true);
  });

  it('approving what is already approved and unchanged is a conflict; renewing a stale one is not', () => {
    const approved = currentDecision([row({ decision: 'approved' })]);
    expect(planDecide({ ...base, current: approved })).toMatchObject({ ok: false, status: 409, code: 'already_approved' });
    expect(planDecide({ ...base, current: approved, stale: true }).ok).toBe(true);
  });
});

describe('approvalChip', () => {
  const approved = currentDecision([row({ decision: 'approved' })]);
  it('names the state in Frame.io words', () => {
    expect(approvalChip(NONE, false)).toEqual({ label: 'Not requested', tone: 'neutral' });
    expect(approvalChip(currentDecision([row({ decision: 'requested' })]), false).label).toBe('Awaiting approval');
    expect(approvalChip(approved, false)).toEqual({ label: 'Approved', tone: 'good' });
    expect(approvalChip(currentDecision([row({ decision: 'changes_requested', note: 'x' })]), false)).toEqual({ label: 'Changes requested', tone: 'warn' });
  });
  it('an approval that no longer matches says so', () => {
    expect(approvalChip(approved, true)).toEqual({ label: 'Stale — changed since approval', tone: 'warn' });
  });
  it('gates are exactly the five of the spec', () => {
    expect([...GATES] as Gate[]).toEqual(['master', 'artwork', 'legal', 'marketing', 'metadata']);
  });
});
