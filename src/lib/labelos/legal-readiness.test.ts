import { describe, expect, it } from 'vitest';
import {
  evaluateLegalReadiness,
  isReady,
  readinessView,
  REQUIREMENT_CODES,
  type LegalFacts,
  type ReadinessSheet,
  type RequirementCode,
} from './legal-readiness';

const NOVA = { id: 'p1', displayName: 'Nova', legalName: 'Nova Ade', ipi: '00123456789', pro: 'ASCAP', proAffiliation: 'affiliated', publisherName: 'Nova Pub' };
const KILO = { id: 'p2', displayName: 'Kilo', legalName: 'Kilo Bay', ipi: '00987654321', pro: 'BMI', proAffiliation: 'affiliated', publisherName: 'Kilo Pub' };
const comp = (status = 'signed', over: Partial<ReadinessSheet> = {}): ReadinessSheet => ({
  id: 'sc', kind: 'composition', version: 1, status,
  lines: [
    { partyId: 'p1', role: 'writer', share: 50, signed: status === 'signed' },
    { partyId: 'p2', role: 'writer', share: 50, signed: status === 'signed' },
  ],
  ...over,
});
const mast = (status = 'signed', over: Partial<ReadinessSheet> = {}): ReadinessSheet => ({
  id: 'sm', kind: 'master', version: 1, status,
  lines: [{ partyId: 'p1', role: 'master_owner', share: '100.0000', signed: status === 'signed' }],
  ...over,
});

/** A song that satisfies every requirement; each test breaks exactly one thing. */
function ready(over: Partial<LegalFacts> = {}): LegalFacts {
  return {
    title: 'Night Shift (feat. Kilo)',
    credits: [
      { id: 'c1', role: 'songwriter', scope: 'composition', status: 'confirmed', partyId: 'p1', name: 'Nova' },
      { id: 'c2', role: 'composer', scope: 'composition', status: 'confirmed', partyId: 'p2', name: 'Kilo' },
      { id: 'c3', role: 'producer', scope: 'recording', status: 'confirmed', partyId: 'p2', name: 'Kilo' },
      { id: 'c4', role: 'feature', scope: 'recording', status: 'confirmed', partyId: 'p2', name: 'Kilo' },
    ],
    parties: [NOVA, KILO],
    sheets: [comp(), mast()],
    onRelease: true,
    samples: 'none',
    sampleClearance: false,
    requireSignedMasterSplit: false,
    isrc: 'USABC2600001',
    ...over,
  };
}

const failing = (f: LegalFacts): RequirementCode[] =>
  evaluateLegalReadiness(f).requirements.filter((r) => r.applicable && !r.satisfied).map((r) => r.code);

describe('a fully ready song', () => {
  const r = evaluateLegalReadiness(ready());
  it('has no gaps and reads 100', () => {
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.score.percent).toBe(100);
    expect(isReady(r)).toBe(true);
  });
  it('covers every requirement code once', () => {
    expect(r.requirements.map((q) => q.code)).toEqual([...REQUIREMENT_CODES]);
  });
});

describe('each requirement: the pass is the ready fixture, the fail is here', () => {
  it('L1 title', () => {
    expect(failing(ready({ title: '  ' }))).toContain('L1');
    expect(failing(ready({ title: null }))).toContain('L1');
  });
  it('L2 writer credited', () => {
    const f = ready({ credits: ready().credits.filter((c) => c.scope !== 'composition') });
    expect(failing(f)).toContain('L2');
    expect(evaluateLegalReadiness(f).requirements.find((q) => q.code === 'L2')).toMatchObject({ severity: 'blocker', fixCapability: 'rights.write' });
  });
  it('L2 an arranger alone is not a writer', () => {
    expect(failing(ready({ credits: [{ id: 'a', role: 'arranger', scope: 'composition', status: 'confirmed', partyId: 'p1', name: 'Nova' }] }))).toContain('L2');
  });
  it('L3 legal name', () => {
    const f = ready({ parties: [{ ...NOVA, legalName: null }, KILO] });
    expect(failing(f)).toContain('L3');
    expect(evaluateLegalReadiness(f).blockers.find((b) => b.code === 'L3')).toMatchObject({ partyId: 'p1', fixCapability: 'rights.write' });
  });
  it('L3 a writer with no party is a gap too', () => {
    expect(failing(ready({ credits: [{ id: 'x', role: 'songwriter', scope: 'composition', status: 'confirmed', partyId: null, name: 'Ghost' }] }))).toContain('L3');
  });
  it('L4 PRO and IPI, or explicitly not affiliated', () => {
    expect(failing(ready({ parties: [{ ...NOVA, ipi: null }, KILO] }))).toContain('L4');
    expect(failing(ready({ parties: [{ ...NOVA, pro: null }, KILO] }))).toContain('L4');
    expect(failing(ready({ parties: [{ ...NOVA, proAffiliation: 'unknown' }, KILO] }))).toContain('L4');
    expect(failing(ready({ parties: [{ ...NOVA, proAffiliation: 'not_affiliated', ipi: null, pro: null }, KILO] }))).not.toContain('L4');
  });
  it('L5 publisher is a warning, and not_affiliated stands in for one', () => {
    const f = ready({ parties: [{ ...NOVA, publisherName: null }, KILO] });
    expect(failing(f)).toContain('L5');
    expect(evaluateLegalReadiness(f).warnings.map((w) => w.code)).toEqual(['L5']);
    expect(failing(ready({ parties: [{ ...NOVA, publisherName: null, proAffiliation: 'not_affiliated' }, KILO] }))).not.toContain('L5');
  });
  it('L6 composition split: missing, draft, not 100, writer absent', () => {
    expect(failing(ready({ sheets: [mast()] }))).toContain('L6');
    expect(failing(ready({ sheets: [comp('draft'), mast()] }))).toContain('L6');
    const short = comp('signed', { lines: [{ partyId: 'p1', role: 'writer', share: 50, signed: true }, { partyId: 'p2', role: 'writer', share: 49.9999, signed: true }] });
    expect(failing(ready({ sheets: [short, mast()] }))).toContain('L6');
    const noKilo = comp('signed', { lines: [{ partyId: 'p1', role: 'writer', share: 100, signed: true }] });
    expect(failing(ready({ sheets: [noKilo, mast()] }))).toContain('L6');
  });
  it('L6 a superseded version is not in force', () => {
    expect(failing(ready({ sheets: [comp('superseded'), mast()] }))).toContain('L6');
  });
  it('L6 uses integer shares: 33.3334 + 33.3333 + 33.3333 is exactly 100', () => {
    const three = comp('signed', {
      lines: [
        { partyId: 'p1', role: 'writer', share: '33.3334', signed: true },
        { partyId: 'p2', role: 'writer', share: '33.3333', signed: true },
        { partyId: 'p3', role: 'writer', share: '33.3333', signed: true },
      ],
    });
    const f = ready({
      credits: [...ready().credits, { id: 'c9', role: 'lyricist', scope: 'composition', status: 'confirmed', partyId: 'p3', name: 'Zed' }],
      parties: [NOVA, KILO, { ...NOVA, id: 'p3', displayName: 'Zed' }],
      sheets: [three, mast()],
    });
    expect(failing(f)).not.toContain('L6');
  });
  it('L7 composition split signed', () => {
    const half = comp('circulated', { lines: [{ partyId: 'p1', role: 'writer', share: 50, signed: true }, { partyId: 'p2', role: 'writer', share: 50, signed: false }] });
    const f = ready({ sheets: [half, mast()] });
    expect(failing(f)).toContain('L7');
    expect(failing(f)).not.toContain('L6');
    expect(evaluateLegalReadiness(f).blockers.find((b) => b.code === 'L7')?.message).toContain('1 of 2');
  });
  it('L8 samples declared', () => {
    expect(failing(ready({ samples: 'unknown' }))).toContain('L8');
    expect(failing(ready({ samples: 'none' }))).not.toContain('L8');
  });
  it('L8 clearance applies only when samples = yes', () => {
    expect(failing(ready({ samples: 'yes', sampleClearance: false }))).toEqual(['L8.clearance']);
    expect(failing(ready({ samples: 'yes', sampleClearance: true }))).toEqual([]);
    expect(evaluateLegalReadiness(ready({ samples: 'none' })).requirements.find((q) => q.code === 'L8.clearance')?.applicable).toBe(false);
  });
  it('L9 producers credited (warning)', () => {
    const f = ready({ credits: ready().credits.filter((c) => c.role !== 'producer') });
    expect(failing(f)).toContain('L9');
    expect(evaluateLegalReadiness(f).warnings.map((w) => w.code)).toContain('L9');
    const co = { id: 'cp', role: 'co_producer', scope: 'recording' as const, status: 'confirmed', partyId: 'p2', name: 'Kilo' };
    expect(failing(ready({ credits: [...f.credits, co] }))).not.toContain('L9');
  });
  it('L10 master split: blocker on a release, excluded off one', () => {
    const on = ready({ sheets: [comp()] });
    expect(failing(on)).toContain('L10');
    expect(evaluateLegalReadiness(on).blockers.map((b) => b.code)).toContain('L10');
    const off = ready({ sheets: [comp()], onRelease: false });
    expect(failing(off)).not.toContain('L10');
    expect(evaluateLegalReadiness(off).blockers.map((b) => b.code)).not.toContain('L10');
    const sixty = mast('signed', { lines: [{ partyId: 'p1', role: 'master_owner', share: 60, signed: true }] });
    expect(failing(ready({ sheets: [comp(), sixty] }))).toContain('L10');
  });
  it('L11 master signed: a warning, a blocker under the org setting', () => {
    const unsigned = [comp(), mast('circulated', { lines: [{ partyId: 'p1', role: 'master_owner', share: 100, signed: false }] })];
    const warn = evaluateLegalReadiness(ready({ sheets: unsigned }));
    expect(warn.warnings.map((w) => w.code)).toEqual(['L11']);
    expect(warn.blockers).toEqual([]);
    const strict = evaluateLegalReadiness(ready({ sheets: unsigned, requireSignedMasterSplit: true }));
    expect(strict.blockers.map((b) => b.code)).toEqual(['L11']);
    expect(isReady(strict)).toBe(false);
  });
  it('L12 a title naming a feature needs the credit', () => {
    const f = ready({ credits: ready().credits.filter((c) => c.role !== 'feature') });
    expect(failing(f)).toContain('L12');
    expect(failing({ ...f, title: 'Night Shift' })).not.toContain('L12');
  });
  it('L13 proposed is a warning, disputed a blocker', () => {
    const mark = (status: string) => ready({ credits: ready().credits.map((c) => (c.id === 'c3' ? { ...c, status } : c)) });
    const p = evaluateLegalReadiness(mark('proposed'));
    expect(p.warnings.map((w) => w.code)).toEqual(['L13']);
    expect(isReady(p)).toBe(true);
    const d = evaluateLegalReadiness(mark('disputed'));
    expect(d.blockers.map((b) => b.code)).toEqual(['L13']);
    expect(isReady(d)).toBe(false);
  });
  it('L14 ISRC (a warning here)', () => {
    const f = ready({ isrc: null });
    expect(failing(f)).toEqual(['L14']);
    expect(evaluateLegalReadiness(f).warnings[0]).toMatchObject({ code: 'L14', fixCapability: 'release.write', severity: 'warning' });
  });
  it('fix capabilities follow 09 §3.1', () => {
    const caps = Object.fromEntries(evaluateLegalReadiness(ready()).requirements.map((q) => [q.code, q.fixCapability]));
    expect(caps).toMatchObject({ L1: 'catalog.write', L2: 'rights.write', L6: 'rights.write', L8: 'catalog.write', L10: 'rights.write', L14: 'release.write' });
  });
});

describe('score', () => {
  it('weighs blockers 3 and warnings 1 over the applicable requirements', () => {
    const total = evaluateLegalReadiness(ready()).score.applicableWeight;
    const warn = evaluateLegalReadiness(ready({ isrc: null }));
    expect(warn.score).toMatchObject({ applicableWeight: total, satisfiedWeight: total - 1 });
    expect(warn.score.percent).toBe(Math.round(((total - 1) / total) * 100));
    expect(evaluateLegalReadiness(ready({ title: '' })).score.satisfiedWeight).toBe(total - 3);
  });
  it('excludes requirements that do not apply', () => {
    const on = evaluateLegalReadiness(ready({ onRelease: true }));
    const off = evaluateLegalReadiness(ready({ onRelease: false }));
    expect(on.score.applicableWeight - off.score.applicableWeight).toBe(3); // L10 is a blocker
    const yes = evaluateLegalReadiness(ready({ samples: 'yes', sampleClearance: true }));
    expect(yes.score.applicableWeight - on.score.applicableWeight).toBe(3); // L8 clearance joins
  });
  it('never reads 100 while something is open', () => {
    expect(evaluateLegalReadiness(ready({ isrc: null })).score.percent).toBeLessThanOrEqual(99);
  });
  it('an empty song scores low and does not throw', () => {
    const r = evaluateLegalReadiness(ready({ title: null, credits: [], parties: [], sheets: [], onRelease: false, samples: 'unknown', isrc: null }));
    expect(r.score.percent).toBeLessThan(50);
    expect(r.blockers.length).toBeGreaterThan(0);
  });
});

describe('the gate is the blockers, not the score', () => {
  it('a song with a high score but a blocker is not ready', () => {
    const r = evaluateLegalReadiness(ready({ title: '' }));
    expect(r.score.percent).toBeGreaterThanOrEqual(90);
    expect(isReady(r)).toBe(false);
  });
  it('a song with only warnings is ready even at a low score', () => {
    const r = evaluateLegalReadiness(
      ready({
        isrc: null,
        credits: ready().credits.filter((c) => c.role !== 'producer').map((c) => ({ ...c, status: 'proposed' })),
        parties: [{ ...NOVA, publisherName: null }, { ...KILO, publisherName: null }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(3);
    expect(isReady(r)).toBe(true);
  });
});

describe('readinessView', () => {
  const gaps = evaluateLegalReadiness(ready({ parties: [{ ...NOVA, legalName: null, ipi: null }, KILO], isrc: null }));
  it('without rights.read carries counts and the percent only', () => {
    const v = readinessView(gaps, false);
    expect(v).toEqual({ detail: 'counts', ready: false, percent: gaps.score.percent, blockerCount: gaps.blockers.length, warningCount: gaps.warnings.length });
    const text = JSON.stringify(v);
    expect(text).not.toContain('Nova');
    expect(text).not.toContain('legal name');
    expect(text).not.toContain('IPI');
  });
  it('with rights.read names the gaps, field by field', () => {
    const v = readinessView(gaps, true);
    expect(v.detail).toBe('full');
    if (v.detail !== 'full') return;
    expect(v.requirements.find((q) => q.code === 'L3')?.reasons[0]).toEqual({
      message: 'Nova has no legal name.',
      severity: 'blocker',
      fixCapability: 'rights.write',
      partyId: 'p1',
      creditId: 'c1',
      sheetId: null,
    });
    expect(v.blockerCount).toBe(gaps.blockers.length);
  });
});
