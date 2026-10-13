import { describe, expect, it } from 'vitest';
import { parseReadinessSettings } from '@/lib/contracts';
import { buildSnapshot, currentDecision, GATES, type ApprovalRow, type Gate } from './approvals';
import type { LegalReadiness, Reason } from './legal-readiness';
import {
  evaluateReleaseReadiness,
  RELEASE_GATES,
  releaseReadinessView,
  type ReadinessApproval,
  type ReadinessItem,
  type ReleaseReadinessFacts,
} from './release-readiness';

const S1 = 's1';
const S2 = 's2';

const item = (n: number, song = S1, extra: Partial<ReadinessItem> = {}): ReadinessItem => ({
  id: `i${n}`, position: n, songId: song, songOk: true, masterId: `m${n}`, masterRelation: 'master', isrc: `USABC260000${n}`, ...extra,
});

const reason = (code: string, severity: 'blocker' | 'warning' = 'blocker'): Reason => ({ code: code as Reason['code'], severity, message: `Nova has no legal name (${code}).`, fixCapability: 'rights.write' });
const legal = (blockers: Reason[] = [], warnings: Reason[] = []): LegalReadiness => ({
  requirements: [], blockers, warnings, score: { percent: blockers.length ? 40 : 100, satisfiedWeight: 1, applicableWeight: 2 },
});

let clock = 0;
const row = (gate: Gate, decision: string, snapshot: unknown): ApprovalRow => ({
  id: `a${clock}`, org_id: 'o', song_id: null, release_id: 'r', gate, decision, note: null, actor_id: 'u', approver_id: null,
  request_id: null, subject_snapshot: snapshot, created_at: `2026-10-01T00:00:${String(clock++).padStart(2, '0')}Z`,
});

const snap = (gate: Gate, parts: Record<string, unknown> = {}) => ({ ...buildSnapshot(gate, {}), parts });
const none = (gate: Gate): ReadinessApproval => ({ current: currentDecision([]), now: buildSnapshot(gate, {}) });
const approved = (gate: Gate): ReadinessApproval => {
  const now = buildSnapshot(gate, {});
  return { current: currentDecision([row(gate, 'approved', now)]), now };
};

function ready(over: Partial<ReleaseReadinessFacts> = {}): ReleaseReadinessFacts {
  return {
    release: {
      state: 'draft', title: 'Nova EP', type: 'single', primaryArtist: 'Nova', labelName: 'Label', pLine: '℗ 2026 Label', cLine: '© 2026 Label',
      primaryGenre: 'Pop', targetDate: '2026-12-01', releaseDate: null, upc: '123456789012', artworkAssetId: 'art',
    },
    artwork: { mime: 'image/jpeg' },
    items: [item(1), item(2, S2)],
    legal: new Map([[S1, legal()], [S2, legal()]]),
    approvals: Object.fromEntries(GATES.map((g) => [g, approved(g)])) as Record<Gate, ReadinessApproval>,
    settings: parseReadinessSettings({}),
    ...over,
  };
}

const status = (f: ReleaseReadinessFacts, g: (typeof RELEASE_GATES)[number]) => evaluateReleaseReadiness(f).gates[g].status;

describe('settings are total', () => {
  it('defaults on a missing, malformed or unknown value, and drops unknown keys', () => {
    expect(parseReadinessSettings(null)).toEqual({ legal_gate: 'on', marketing_gate: 'on', require_signed_master_split: false });
    expect(parseReadinessSettings('off')).toEqual(parseReadinessSettings({}));
    expect(parseReadinessSettings([])).toEqual(parseReadinessSettings({}));
    expect(parseReadinessSettings({ legal_gate: 'maybe', marketing_gate: 0, require_signed_master_split: 'yes', digest: {} })).toEqual({
      legal_gate: 'on', marketing_gate: 'on', require_signed_master_split: false,
    });
    expect(parseReadinessSettings({ legal_gate: 'off', marketing_gate: 'off', require_signed_master_split: true })).toEqual({
      legal_gate: 'off', marketing_gate: 'off', require_signed_master_split: true,
    });
  });
});

describe('a release with everything in order', () => {
  it('is ready to deliver; every gate is approved or satisfied', () => {
    const r = evaluateReleaseReadiness(ready());
    expect(r.readyToDeliver).toBe(true);
    expect(Object.fromEntries(RELEASE_GATES.map((g) => [g, r.gates[g].status]))).toEqual({
      tracklist: 'satisfied', masters: 'approved', credits_splits: 'satisfied', legal: 'approved', artwork: 'approved', metadata: 'approved', marketing: 'approved',
    });
  });
});

describe('switches', () => {
  it('legal_gate off skips only the legal approval; credits & splits still gate', () => {
    const f = ready({ settings: parseReadinessSettings({ legal_gate: 'off' }), approvals: { ...ready().approvals, legal: none('legal') } });
    expect(status(f, 'legal')).toBe('not_required');
    expect(evaluateReleaseReadiness(f).readyToDeliver).toBe(true);
    const blocked = ready({ settings: parseReadinessSettings({ legal_gate: 'off' }), legal: new Map([[S1, legal([reason('L7')])], [S2, legal()]]) });
    expect(status(blocked, 'legal')).toBe('not_required');
    expect(status(blocked, 'credits_splits')).toBe('blocked');
    expect(evaluateReleaseReadiness(blocked).readyToDeliver).toBe(false);
  });
  it('legal_gate on needs an approval', () => {
    const f = ready({ approvals: { ...ready().approvals, legal: none('legal') } });
    expect(status(f, 'legal')).toBe('not_started');
    expect(evaluateReleaseReadiness(f).readyToDeliver).toBe(false);
  });
  it('marketing_gate off skips marketing; on needs an approval', () => {
    const base = { ...ready().approvals, marketing: none('marketing') };
    const off = ready({ settings: parseReadinessSettings({ marketing_gate: 'off' }), approvals: base });
    expect(status(off, 'marketing')).toBe('not_required');
    expect(evaluateReleaseReadiness(off).readyToDeliver).toBe(true);
    const on = ready({ approvals: base });
    expect(status(on, 'marketing')).toBe('not_started');
    expect(evaluateReleaseReadiness(on).readyToDeliver).toBe(false);
  });
});

describe('approval states', () => {
  const withApproval = (gate: Gate, a: ReadinessApproval) => ready({ approvals: { ...ready().approvals, [gate]: a } });

  it('never requested → not_started; requested → awaiting_approval', () => {
    expect(status(withApproval('marketing', none('marketing')), 'marketing')).toBe('not_started');
    const now = buildSnapshot('marketing', {});
    expect(status(withApproval('marketing', { current: currentDecision([row('marketing', 'requested', null)]), now }), 'marketing')).toBe('awaiting_approval');
  });
  it('changes requested → blocked with a blocker', () => {
    const now = buildSnapshot('marketing', {});
    const g = evaluateReleaseReadiness(withApproval('marketing', { current: currentDecision([row('marketing', 'changes_requested', now)]), now })).gates.marketing;
    expect(g.status).toBe('blocked');
    expect(g.blockers.map((b) => b.code)).toContain('changes_requested');
  });
  it('a new request re-opens an approved gate', () => {
    const now = buildSnapshot('marketing', {});
    const rows = [row('marketing', 'approved', now), row('marketing', 'requested', null)];
    expect(status(withApproval('marketing', { current: currentDecision(rows), now }), 'marketing')).toBe('awaiting_approval');
  });
  it('an approval whose snapshot no longer matches is stale, and the release is not ready', () => {
    const approvedItems = snap('master', { items: [{ songId: S1, masterId: 'old' }] });
    const now = buildSnapshot('master', { items: [{ songId: S1, masterId: 'm1' }] });
    const f = withApproval('master', { current: currentDecision([row('master', 'approved', approvedItems)]), now });
    const r = evaluateReleaseReadiness(f);
    expect(r.gates.masters.status).toBe('stale');
    expect(r.gates.masters.approval?.stale).toBe(true);
    expect(r.gates.masters.blockers[0].message).toContain('items');
    expect(r.readyToDeliver).toBe(false);
  });
  it('an approval with no readable snapshot is stale', () => {
    const now = buildSnapshot('artwork', { artworkAssetId: 'art' });
    expect(status(withApproval('artwork', { current: currentDecision([row('artwork', 'approved', null)]), now }), 'artwork')).toBe('stale');
  });
  it('splits changed after the legal approval → stale legal gate', () => {
    const was = snap('legal', { songs: [{ id: S1, sheets: [{ id: 'a', kind: 'composition', version: 1 }], credits: [] }] });
    const now = buildSnapshot('legal', { songs: [{ id: S1, sheets: [{ id: 'b', kind: 'composition', version: 2 }], credits: [] }] });
    expect(status(withApproval('legal', { current: currentDecision([row('legal', 'approved', was)]), now }), 'legal')).toBe('stale');
  });
  it('a precondition blocker wins the status but a stale approval is still listed', () => {
    const now = buildSnapshot('legal', { songs: [{ id: S1, sheets: [], credits: [] }] });
    const f = ready({ legal: new Map([[S1, legal([reason('L6')])], [S2, legal()]]), approvals: { ...ready().approvals, legal: { current: currentDecision([row('legal', 'approved', snap('legal', { songs: [] }))]), now } } });
    const g = evaluateReleaseReadiness(f).gates.legal;
    expect(g.status).toBe('blocked');
    expect(g.blockers.map((b) => b.code)).toEqual(['credits_splits_open', 'approval_stale']);
  });
});

describe('the legal gate delegates to LABEL-29 blockers, never the percentage', () => {
  it('a blocker anywhere blocks credits_splits and legal; a warning does not', () => {
    const f = ready({ legal: new Map([[S1, legal()], [S2, legal([reason('L7')])]]) });
    const r = evaluateReleaseReadiness(f);
    expect(r.gates.credits_splits.status).toBe('blocked');
    expect(r.gates.credits_splits.blockers[0]).toMatchObject({ code: 'L7', songId: S2, sensitive: true });
    expect(r.gates.legal.status).toBe('blocked');
    const warn = evaluateReleaseReadiness(ready({ legal: new Map([[S1, legal([], [reason('L5', 'warning')])], [S2, legal()]]) }));
    expect(warn.gates.credits_splits.status).toBe('satisfied');
    expect(warn.gates.credits_splits.warnings).toHaveLength(1);
  });
  it('the display percentage is ignored (100% with a blocker still blocks)', () => {
    const l = { ...legal([reason('L7')]), score: { percent: 100, satisfiedWeight: 1, applicableWeight: 1 } };
    expect(status(ready({ legal: new Map([[S1, l], [S2, legal()]]) }), 'credits_splits')).toBe('blocked');
  });
  it('a song whose legal readiness is missing is not ready by omission', () => {
    expect(status(ready({ legal: new Map([[S1, legal()]]) }), 'credits_splits')).toBe('blocked');
  });
});

describe('tracklist, masters, artwork, metadata', () => {
  it('an empty release: tracklist blocked, nothing else started, not ready', () => {
    const r = evaluateReleaseReadiness(ready({ items: [], legal: new Map() }));
    expect(r.gates.tracklist.status).toBe('blocked');
    expect(r.gates.tracklist.blockers[0].code).toBe('no_tracks');
    expect(r.gates.masters.status).toBe('not_started');
    expect(r.gates.credits_splits.status).toBe('not_started');
    expect(r.gates.legal.status).toBe('not_started');
    expect(r.readyToDeliver).toBe(false);
  });
  it('a position gap or a non-song item blocks the tracklist', () => {
    expect(status(ready({ items: [item(1), item(3, S2)] }), 'tracklist')).toBe('blocked');
    expect(status(ready({ items: [item(1), item(2, S2, { songOk: false })] }), 'tracklist')).toBe('blocked');
  });
  it('the song’s own mix, or an unlinked recording, is not a master; instrumental and version are', () => {
    expect(status(ready({ items: [item(1, S1, { masterRelation: 'self' })] }), 'masters')).toBe('blocked');
    expect(status(ready({ items: [item(1, S1, { masterRelation: null })] }), 'masters')).toBe('blocked');
    expect(status(ready({ items: [item(1, S1, { masterRelation: 'instrumental' })] }), 'masters')).toBe('approved');
    expect(status(ready({ items: [item(1, S1, { masterRelation: 'version' })] }), 'masters')).toBe('approved');
  });
  it('artwork: none, a missing file, a wrong type, then fine', () => {
    const rel = ready().release;
    expect(status(ready({ release: { ...rel, artworkAssetId: null }, artwork: null }), 'artwork')).toBe('blocked');
    expect(status(ready({ artwork: null }), 'artwork')).toBe('blocked');
    expect(status(ready({ artwork: { mime: 'image/gif' } }), 'artwork')).toBe('blocked');
    expect(status(ready({ artwork: { mime: null } }), 'artwork')).toBe('blocked');
    expect(status(ready({ artwork: { mime: 'IMAGE/PNG' } }), 'artwork')).toBe('approved');
  });
  it('metadata lists every missing field and every item without an ISRC', () => {
    const rel = ready().release;
    const f = ready({ release: { ...rel, upc: ' ', labelName: null, pLine: null, targetDate: null, releaseDate: null }, items: [item(1, S1, { isrc: null }), item(2, S2)] });
    const g = evaluateReleaseReadiness(f).gates.metadata;
    expect(g.status).toBe('blocked');
    expect(g.blockers.map((b) => b.code).sort()).toEqual(['date', 'isrc', 'label_name', 'p_line', 'upc']);
    expect(status(ready({ release: { ...rel, targetDate: null, releaseDate: '2026-12-01' } }), 'metadata')).toBe('approved');
  });
});

describe('release state', () => {
  it('a cancelled release requires nothing and is never ready', () => {
    const r = evaluateReleaseReadiness(ready({ release: { ...ready().release, state: 'cancelled' }, items: [] }));
    expect(RELEASE_GATES.every((g) => r.gates[g].status === 'not_required')).toBe(true);
    expect(r.readyToDeliver).toBe(false);
    expect(r.releaseState).toBe('cancelled');
  });
  it('a delivered release keeps its gates but is not ready to deliver again', () => {
    const r = evaluateReleaseReadiness(ready({ release: { ...ready().release, state: 'delivered' } }));
    expect(r.gates.tracklist.status).toBe('satisfied');
    expect(r.readyToDeliver).toBe(false);
  });
});

describe('what a caller may be told', () => {
  const blocked = evaluateReleaseReadiness(ready({ legal: new Map([[S1, legal([reason('L3'), reason('L7')])], [S2, legal()]]) }));
  it('rights.read lists the named blockers', () => {
    const g = releaseReadinessView(blocked, true).gates.credits_splits;
    expect(g.blockers).toHaveLength(2);
    expect(g.blockers[0].message).toContain('Nova');
    expect(g.withheld).toBe(0);
  });
  it('without it: counts only, nothing names a party, and the rest still shows', () => {
    const v = releaseReadinessView(blocked, false);
    expect(v.gates.credits_splits).toMatchObject({ status: 'blocked', blockerCount: 2, blockers: [], withheld: 2 });
    expect(JSON.stringify(v)).not.toContain('Nova');
    // The legal gate's own blocker only counts gaps.
    expect(v.gates.legal.blockers.map((b) => b.code)).toEqual(['credits_splits_open']);
  });
  it('is built field by field', () => {
    const v = releaseReadinessView(blocked, true);
    expect(Object.keys(v.gates.credits_splits.blockers[0]).sort()).toEqual(['code', 'fixCapability', 'itemId', 'message', 'songId']);
    expect(Object.keys(v.gates.masters.approval ?? {}).sort()).toEqual(['decidedAt', 'gate', 'requestedAt', 'stale', 'status']);
  });
});
