import { describe, expect, it } from 'vitest';
import {
  FACE_PRESETS,
  departmentsOn,
  effectiveGates,
  emptyEntry,
  firstBlockedStep,
  isUntouched,
  loadDraft,
  newDraft,
  parseDraft,
  planSetupSettings,
  releaseRequest,
  saveDraft,
  clearDraft,
  serializeDraft,
  setupBodyFromDraft,
  settingsFromDraft,
  stepProblems,
  withContractType,
  withDepartment,
  withFace,
  nextStep,
  skipStep,
  previousStep,
  type DraftStorage,
  type WizardDraft,
} from './setup-wizard';

const label = (over: Partial<WizardDraft> = {}): WizardDraft => ({ ...withFace(newDraft(), 'label'), name: 'Northside', ...over });
const solo = (over: Partial<WizardDraft> = {}): WizardDraft => ({ ...withFace(newDraft(), 'independent'), name: 'Nova', ...over });

function memory(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('presets', () => {
  it('a label starts with every department on, an independent artist without the label-only ones', () => {
    expect(departmentsOn(label())).toHaveLength(7);
    expect(departmentsOn(solo()).sort()).toEqual(['contracts', 'marketing', 'store']);
  });
  it('changing face follows the preset until the person touches a department', () => {
    expect(withFace(solo(), 'label').departmentsOff).toEqual([]);
    const touched = withDepartment(solo(), 'finance', true);
    expect(touched.departmentsTouched).toBe(true);
    expect(withFace(touched, 'label').departmentsOff).toEqual(FACE_PRESETS.independent.departmentsOff.filter((m) => m !== 'finance'));
  });
  it('contract types follow the preset until touched, and keep vocabulary order', () => {
    expect(solo().contractTypes).toEqual(['licence', 'producer', 'feature']);
    const picked = withContractType(withContractType(solo(), 'management', true), 'recording', true);
    expect(picked.contractTypes).toEqual(['recording', 'licence', 'producer', 'feature', 'management']);
    expect(withFace(picked, 'label').contractTypes).toEqual(picked.contractTypes);
  });
  it('an independent artist has no roster list to carry', () => {
    const l = label({ roster: [{ name: 'A', email: '' }] });
    expect(withFace(l, 'independent').roster).toEqual([]);
  });
});

describe('skipping a step', () => {
  it('puts the step back to the face preset or to nobody, so half-typed input cannot block the review', () => {
    const d = withDepartment(withContractType(label({ roster: [{ name: '', email: 'bad' }], team: [emptyEntry()] }), 'management', true), 'finance', false);
    expect(skipStep(d, 'work').contractTypes).toEqual(FACE_PRESETS.label.contractTypes);
    expect(skipStep(d, 'departments').departmentsOff).toEqual([]);
    const t = skipStep(d, 'team');
    expect([t.roster, t.team]).toEqual([[], []]);
    expect(skipStep(label({ release: { enabled: true, title: 'x', type: 'single', artistIndex: 0 } }), 'team').release.enabled).toBe(false);
    expect(stepProblems(t, 'team')).toEqual([]);
    expect(skipStep(d, 'who')).toBe(d);
  });
});

describe('gates', () => {
  it('Contracts & legal off takes legal approval off with it, and says so', () => {
    const d = withDepartment(label(), 'contracts', false);
    expect(effectiveGates(d)).toEqual({ legal_gate: 'off', marketing_gate: 'on', legalForcedOff: true });
    expect(settingsFromDraft(d).legal_gate).toBe('off');
  });
  it('legal approval stays on with the department on', () => {
    expect(effectiveGates(label())).toMatchObject({ legal_gate: 'on', legalForcedOff: false });
  });
});

describe('settings sent at creation', () => {
  it('keeps only what differs from the defaults', () => {
    const plan = planSetupSettings(settingsFromDraft(label({ contractTypes: [] })));
    expect(plan).toEqual({ ok: true, patch: {}, keys: [] });
    const some = planSetupSettings(settingsFromDraft(solo()));
    expect(some.ok && some.keys.sort()).toEqual(['contract_types', 'departments_off']);
  });
  it('refuses the lockout the settings screen refuses', () => {
    const plan = planSetupSettings({ legal_gate: 'on', departments_off: ['contracts'] });
    expect(plan.ok).toBe(false);
  });
  it('is null until a face and a name exist', () => {
    expect(setupBodyFromDraft(newDraft())).toBeNull();
    expect(setupBodyFromDraft(solo({ name: '   ' }))).toBeNull();
    expect(setupBodyFromDraft(solo())).toMatchObject({ face: 'independent', name: 'Nova' });
  });
});

describe('validation', () => {
  it('step 1 needs a face and a name; the rest may be skipped', () => {
    expect(stepProblems(newDraft(), 'who')).toHaveLength(2);
    expect(stepProblems(solo(), 'who')).toEqual([]);
    for (const s of ['work', 'departments'] as const) expect(stepProblems(newDraft(), s)).toEqual([]);
    expect(firstBlockedStep(newDraft())).toBe('who');
    expect(firstBlockedStep(solo())).toBeNull();
  });
  it('checks emails, duplicates and login passwords on the team step', () => {
    const d = label({
      roster: [{ name: 'Nova', email: 'bad' }, { name: 'nova', email: '' }],
      team: [
        { ...emptyEntry(), email: 'a@x.test', fn: 'marketing' },
        { ...emptyEntry(), email: 'A@x.test', fn: 'legal', mode: 'login', name: '', password: 'short' },
        { ...emptyEntry(), email: 'c@x.test' },
      ],
    });
    const problems = stepProblems(d, 'team').join('\n');
    expect(problems).toMatch(/Artist 1: that email/);
    expect(problems).toMatch(/same name/);
    expect(problems).toMatch(/same email/);
    expect(problems).toMatch(/Person 2: enter their name/);
    expect(problems).toMatch(/Person 2: Use at least/);
    expect(problems).toMatch(/Person 3: choose their function/);
  });
  it('the first release needs a title and, in a label, one of the roster artists', () => {
    const on = { enabled: true, title: '', type: 'single' as const, artistIndex: 0 };
    expect(stepProblems(solo({ release: on }), 'review')).toHaveLength(1);
    expect(stepProblems(label({ release: { ...on, title: 'First' } }), 'review')).toHaveLength(1);
    expect(stepProblems(label({ roster: [{ name: 'Nova', email: '' }], release: { ...on, title: 'First' } }), 'review')).toEqual([]);
  });
  it('steps move one at a time and stop at the ends', () => {
    expect(nextStep('who')).toBe('work');
    expect(nextStep('review')).toBe('review');
    expect(previousStep('who')).toBe('who');
  });
});

describe('the saved draft', () => {
  it('never saves a password', () => {
    const d = label({ team: [{ ...emptyEntry(), email: 'a@x.test', fn: 'legal', mode: 'login', name: 'A', password: 'hunter2-hunter2' }] });
    expect(serializeDraft(d)).not.toContain('hunter2');
    expect(parseDraft(serializeDraft(d))?.team[0]).toMatchObject({ email: 'a@x.test', mode: 'login', password: '' });
  });
  it('round-trips through storage and clears', () => {
    const store = memory();
    const d = { ...solo(), step: 'team' as const };
    expect(saveDraft(store, 'u1', d)).toBe(true);
    expect(loadDraft(store, 'u1')).toEqual(d);
    expect(loadDraft(store, 'u2')).toBeNull();
    clearDraft(store, 'u1');
    expect(loadDraft(store, 'u1')).toBeNull();
  });
  it('survives storage that throws, and null storage', () => {
    const broken: DraftStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadDraft(broken, 'u')).toBeNull();
    expect(saveDraft(broken, 'u', solo())).toBe(false);
    expect(() => clearDraft(broken, 'u')).not.toThrow();
    expect(saveDraft(null, 'u', solo())).toBe(false);
    expect(loadDraft(null, 'u')).toBeNull();
  });
  it('reads garbage as nothing and a partly bad draft as far as it is sound', () => {
    expect(parseDraft('{nope')).toBeNull();
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ version: 2 })).toBeNull();
    const d = parseDraft({
      version: 1, step: 'bogus', face: 'label', name: 42, contractTypes: ['recording', 'nonsense'], departmentsOff: ['finance', 'export', 'x'],
      team: [{ email: 'a@x.test', role: 'owner', fn: 'nope', mode: 'wat' }, 7], roster: 'no', release: { enabled: true, type: 'zzz', artistIndex: -1 },
    });
    expect(d).toMatchObject({
      step: 'who', face: 'label', name: '', contractTypes: ['recording'], departmentsOff: ['finance'], roster: [],
      release: { enabled: true, type: 'single', artistIndex: 0 },
    });
    expect(d?.team).toEqual([{ email: 'a@x.test', role: 'member', fn: null, mode: 'invite', name: '', password: '', scope: 'org', artists: [] }]);
    expect(d?.collaborators).toEqual([]);
  });
  it('keeps artist scope, artist logins and collaborators, and never a project (none exists yet)', () => {
    const d = parseDraft({
      version: 1, step: 'team', face: 'label', name: 'N',
      roster: [{ name: 'Nova', email: 'n@x.test', invite: true }],
      team: [
        { email: 'a@x.test', role: 'member', fn: 'a_and_r', mode: 'invite', scope: 'artists', artists: ['Nova', 7, 'Kai'] },
        { email: 'b@x.test', role: 'admin', mode: 'invite', scope: 'artists', artists: ['Nova'] },
      ],
      collaborators: [{ name: 'Kai', email: '', kind: 'rapper', projectId: 'abc', projectRole: 'editor' }, { name: 'Bo', kind: 'nope', projectRole: 'boss' }, 'x'],
    });
    expect(d?.roster).toEqual([{ name: 'Nova', email: 'n@x.test', invite: true }]);
    expect(d?.team[0]).toMatchObject({ scope: 'artists', artists: ['Nova', 'Kai'] });
    expect(d?.team[1]).toMatchObject({ role: 'admin', scope: 'org' });
    expect(d?.collaborators).toEqual([
      { name: 'Kai', email: '', kind: 'rapper', projectId: '', projectRole: 'editor' },
      { name: 'Bo', email: '', kind: 'beatmaker', projectId: '', projectRole: 'viewer' },
    ]);
  });
  it('an independent artist has no roster, even in an old draft', () => {
    expect(parseDraft({ version: 1, step: 'team', face: 'independent', name: 'N', roster: [{ name: 'Me', email: '' }] })?.roster).toEqual([]);
  });
  it('knows an untouched draft', () => {
    expect(isUntouched(newDraft())).toBe(true);
    expect(isUntouched(solo())).toBe(false);
  });
});

describe('the team step', () => {
  it('skipping it forgets artists, people and collaborators alike', () => {
    const d = label({ roster: [{ name: 'Nova', email: '' }], team: [emptyEntry()], collaborators: [{ name: 'Kai', email: '', kind: 'rapper', projectId: '', projectRole: 'viewer' }] });
    expect(skipStep(d, 'team')).toMatchObject({ roster: [], team: [], collaborators: [] });
  });
  it('shares the Team page rules: a member limited to artists must name one that is being added', () => {
    const base = label({ roster: [{ name: 'Nova', email: '' }] });
    const scoped = (artists: string[]) => ({ ...emptyEntry(), email: 'a@x.test', fn: 'a_and_r' as const, scope: 'artists' as const, artists });
    expect(stepProblems({ ...base, team: [scoped([])] }, 'team').join()).toMatch(/choose at least one artist/);
    expect(stepProblems({ ...base, team: [scoped(['Nova'])] }, 'team')).toEqual([]);
  });
  it('switching to the independent face drops the roster and any scope pointing at it', () => {
    const d = withFace(label({ roster: [{ name: 'Nova', email: '' }], team: [{ ...emptyEntry(), email: 'a@x.test', fn: 'legal', scope: 'artists', artists: ['Nova'] }] }), 'independent');
    expect(d.roster).toEqual([]);
    expect(d.team[0]).toMatchObject({ scope: 'org', artists: [] });
  });
  it('collaborators count as touched', () => {
    expect(isUntouched(label({ collaborators: [{ name: '', email: '', kind: 'rapper', projectId: '', projectRole: 'viewer' }] }))).toBe(false);
  });
});

describe('requests after the org exists', () => {
  it('the first release is the existing release route with the roster artist', () => {
    expect(releaseRequest(solo(), 'c1')).toBeNull();
    const d = solo({ release: { enabled: true, title: ' First ', type: 'ep', artistIndex: 0 } });
    expect(releaseRequest(d, 'c1')).toMatchObject({ path: '/releases', body: { title: 'First', type: 'ep', contact_id: 'c1' } });
  });
});
