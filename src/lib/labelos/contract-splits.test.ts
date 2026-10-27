import { describe, expect, it } from 'vitest';
import { MERGE_FIELDS } from './contracts/merge-fields';
import { platformTemplates } from './contracts/templates';
import type { PartyRole, TemplateTypeId } from './contracts/types';
import {
  CONTRACT_SPLIT_RULES,
  canSignContract,
  deriveDrift,
  driftView,
  expectedForRule,
  hasDrift,
  isSplitContractType,
  planDraftWrite,
  planPrefill,
  ruleFor,
  spreadUnits,
  type ContractFacts,
} from './contract-splits';
import { FULL_SHARE, parseShare, validateSheet } from './splits';

const u = (s: string) => parseShare(s)!;

function contract(type: TemplateTypeId, fields: Record<string, string>, parties: [string, PartyRole][], over: Partial<ContractFacts> = {}): ContractFacts {
  return { type, status: 'sent', trackId: 'song-1', fields, parties: parties.map(([partyId, role]) => ({ partyId, role })), ...over };
}

describe('which contract types apply', () => {
  it('is exactly the types whose template asks for a master or publishing share', () => {
    const fromTemplates = platformTemplates()
      .filter((t) => t.suggestedFields.includes('master_share') || t.suggestedFields.includes('publishing_share'))
      .map((t) => t.type)
      .sort();
    expect(Object.keys(CONTRACT_SPLIT_RULES).sort()).toEqual(fromTemplates);
  });

  it('each rule reads a field its template suggests and a holder role its template has a slot for', () => {
    for (const t of platformTemplates()) {
      for (const rule of CONTRACT_SPLIT_RULES[t.type] ?? []) {
        expect(t.suggestedFields, `${t.type} ${rule.field}`).toContain(rule.field);
        const slots = t.slots.map((s) => s.role);
        for (const r of rule.holders) expect(slots, `${t.type} holder ${r}`).toContain(r);
        for (const r of rule.remainder?.roles ?? []) expect(slots, `${t.type} remainder ${r}`).toContain(r);
        expect(MERGE_FIELDS.some((f) => f.key === rule.field && f.kind === 'percent')).toBe(true);
      }
    }
  });

  it('a recording agreement or an NDA does not apply', () => {
    expect(isSplitContractType('recording')).toBe(false);
    expect(isSplitContractType('nda')).toBe(false);
    expect(isSplitContractType('feature')).toBe(true);
  });
});

describe('spreadUnits', () => {
  it('sums to the total, extra units to the first lines', () => {
    expect(spreadUnits(FULL_SHARE, 3)).toEqual([333_334, 333_333, 333_333]);
    expect(spreadUnits(FULL_SHARE, 3).reduce((a, b) => a + b, 0)).toBe(FULL_SHARE);
    expect(spreadUnits(10, 0)).toEqual([]);
  });
});

describe('prefill', () => {
  it('feature: the featured artist holds the stated share, the primary artist the remainder, both exact', () => {
    const c = contract('feature', { master_share: '33.3333', publishing_share: '10' }, [['A', 'artist'], ['F', 'featured']]);
    const [master, comp] = planPrefill(c);
    expect(master).toMatchObject({ kind: 'master', ok: true, incomplete: false });
    if (!master.ok || !comp.ok) throw new Error('plan');
    expect(master.lines).toEqual([
      { partyId: 'F', role: 'master_owner', units: u('33.3333'), firm: true },
      { partyId: 'A', role: 'master_owner', units: u('66.6667'), firm: true },
    ]);
    expect(validateSheet('master', master.lines).ok).toBe(true);
    expect(comp.lines.map((l) => [l.partyId, l.role, l.units])).toEqual([['F', 'writer', u('10')], ['A', 'writer', u('90')]]);
  });

  it('collaboration with three collaborators and 33.3333 each is 99.9999: prefilled, flagged incomplete, and the sheet still refuses to circulate', () => {
    const c = contract('collaboration', { master_share: '33.3333' }, [['X', 'collaborator'], ['Y', 'collaborator'], ['Z', 'collaborator']]);
    const master = planPrefill(c).find((p) => p.kind === 'master')!;
    if (!master.ok) throw new Error('plan');
    expect(master.lines.map((l) => l.units)).toEqual([333_333, 333_333, 333_333]);
    expect(master.incomplete).toBe(true);
    const check = validateSheet('master', master.lines);
    expect(check.ok).toBe(false);
    expect(check.total).toBe(999_999);
  });

  it('collaboration with a blank field divides equally in integers (not firm)', () => {
    const c = contract('collaboration', {}, [['X', 'collaborator'], ['Y', 'collaborator'], ['Z', 'collaborator']]);
    const comp = planPrefill(c).find((p) => p.kind === 'composition')!;
    if (!comp.ok) throw new Error('plan');
    expect(comp.lines.map((l) => l.units)).toEqual([333_334, 333_333, 333_333]);
    expect(comp.lines.every((l) => !l.firm)).toBe(true);
    expect(validateSheet('composition', comp.lines).ok).toBe(true);
  });

  it('co-publishing: the publisher holds the stated share, the writers share the rest equally', () => {
    const c = contract('co_publishing', { publishing_share: '25' }, [['W1', 'collaborator'], ['W2', 'collaborator'], ['P', 'publisher']]);
    const [comp] = planPrefill(c);
    if (!comp.ok) throw new Error('plan');
    expect(comp.lines).toEqual([
      { partyId: 'P', role: 'publisher', units: u('25'), firm: true },
      { partyId: 'W1', role: 'writer', units: u('37.5'), firm: false },
      { partyId: 'W2', role: 'writer', units: u('37.5'), firm: false },
    ]);
  });

  it('producer agreement: only the producer’s publishing share; the rest is left to the person', () => {
    const c = contract('producer', { publishing_share: '50' }, [['L', 'client'], ['P', 'producer']]);
    const plans = planPrefill(c);
    expect(plans).toHaveLength(1);
    const [comp] = plans;
    if (!comp.ok) throw new Error('plan');
    expect(comp.lines).toEqual([{ partyId: 'P', role: 'writer', units: u('50'), firm: true }]);
    expect(comp.incomplete).toBe(true);
  });

  it('says why nothing is prefilled', () => {
    expect(expectedForRule(contract('producer', { publishing_share: '50' }, [['P', 'producer']], { trackId: null }), ruleFor('producer', 'composition')!)).toMatchObject({ ok: false, reason: 'no_song' });
    expect(expectedForRule(contract('producer', {}, [['P', 'producer']]), ruleFor('producer', 'composition')!)).toMatchObject({ ok: false, reason: 'field_missing' });
    expect(expectedForRule(contract('producer', { publishing_share: '50' }, [['L', 'client']]), ruleFor('producer', 'composition')!)).toMatchObject({ ok: false, reason: 'no_holder' });
    expect(expectedForRule(contract('collaboration', { master_share: '60' }, [['X', 'collaborator'], ['Y', 'collaborator']]), ruleFor('collaboration', 'master')!)).toMatchObject({ ok: false, reason: 'over_100' });
    expect(expectedForRule(contract('producer', { publishing_share: '12.34567' }, [['P', 'producer']]), ruleFor('producer', 'composition')!)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(expectedForRule(contract('producer', { publishing_share: '0' }, [['P', 'producer']]), ruleFor('producer', 'composition')!)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('a recording agreement prefills nothing', () => {
    expect(planPrefill(contract('recording', { master_share: '50' }, [['A', 'artist']]))).toEqual([]);
  });

  it('never reads a share through a float', () => {
    // 0.1 + 0.2 style traps: 100 - 33.3333 is exactly 66.6667 in units.
    const c = contract('feature', { master_share: '33.3333' }, [['A', 'artist'], ['F', 'featured']]);
    const m = planPrefill(c)[0];
    if (!m.ok) throw new Error('plan');
    expect(m.lines.reduce((a, l) => a + l.units, 0)).toBe(FULL_SHARE);
  });
});

describe('planDraftWrite', () => {
  it('creates when there is no draft, including beside a circulated or signed sheet', () => {
    expect(planDraftWrite([], 'master', false)).toEqual({ action: 'create' });
    expect(planDraftWrite([{ kind: 'master', status: 'circulated' }, { kind: 'master', status: 'superseded' }], 'master', false)).toEqual({ action: 'create' });
    expect(planDraftWrite([{ kind: 'master', status: 'signed' }], 'master', true)).toEqual({ action: 'create' });
  });
  it('refuses to overwrite a draft unless told to', () => {
    expect(planDraftWrite([{ kind: 'master', status: 'draft' }], 'master', false)).toEqual({ action: 'refuse', reason: 'draft_exists' });
    expect(planDraftWrite([{ kind: 'master', status: 'draft' }], 'master', true)).toEqual({ action: 'replace' });
  });
  it('another kind’s draft does not count', () => {
    expect(planDraftWrite([{ kind: 'composition', status: 'draft' }], 'master', false)).toEqual({ action: 'create' });
  });
});

describe('drift', () => {
  const feature = contract('feature', { master_share: '30', publishing_share: '10' }, [['A', 'artist'], ['F', 'featured']]);
  const sheet = (lines: [string, string][], status = 'circulated', kind = 'master') => ({
    kind,
    status,
    lines: lines.map(([partyId, s]) => ({ partyId, units: u(s) })),
  });

  it('no drift when the sheet carries what the contract states', () => {
    const d = deriveDrift(feature, sheet([['F', '30'], ['A', '70']]))!;
    expect(d.checked).toBe(true);
    expect(hasDrift(d)).toBe(false);
  });

  it('a different share is drift, in a circulated and in a signed sheet', () => {
    for (const status of ['circulated', 'signed']) {
      const d = deriveDrift(feature, sheet([['F', '25'], ['A', '75']], status))!;
      expect(d.items).toEqual([
        { partyId: 'F', code: 'differs', expected: u('30'), actual: u('25') },
        { partyId: 'A', code: 'differs', expected: u('70'), actual: u('75') },
      ]);
    }
  });

  it('a contract party missing from the sheet is drift', () => {
    const d = deriveDrift(feature, sheet([['A', '100']]))!;
    expect(d.items[0]).toEqual({ partyId: 'F', code: 'missing', expected: u('30'), actual: null });
  });

  it('extra people on the sheet are not drift when the stated shares hold', () => {
    const producer = contract('producer', { publishing_share: '20' }, [['L', 'client'], ['P', 'producer']]);
    const d = deriveDrift(producer, sheet([['P', '20'], ['A', '50'], ['B', '30']], 'signed', 'composition'))!;
    expect(hasDrift(d)).toBe(false);
  });

  it('a division the contract did not state is not checked', () => {
    const collab = contract('collaboration', {}, [['X', 'collaborator'], ['Y', 'collaborator']]);
    expect(hasDrift(deriveDrift(collab, sheet([['X', '70'], ['Y', '30']]))!)).toBe(false);
  });

  it('is not compared while the contract is a draft or void, or the sheet is a draft or superseded', () => {
    expect(deriveDrift({ ...feature, status: 'draft' }, sheet([['F', '1'], ['A', '99']]))!.checked).toBe(false);
    expect(deriveDrift({ ...feature, status: 'void' }, sheet([['F', '1'], ['A', '99']]))!.checked).toBe(false);
    expect(deriveDrift(feature, sheet([['F', '1'], ['A', '99']], 'draft'))!.checked).toBe(false);
    expect(deriveDrift(feature, sheet([['F', '1'], ['A', '99']], 'superseded'))!.checked).toBe(false);
  });

  it('is not defined for a kind the contract type has no rule for', () => {
    expect(deriveDrift(feature, sheet([['F', '30']], 'circulated', 'bogus'))).toBeNull();
    expect(deriveDrift(contract('producer', { publishing_share: '20' }, [['P', 'producer']]), sheet([['P', '20']], 'circulated', 'master'))).toBeNull();
  });

  it('D2: a view without rights.read carries no name, share or total', () => {
    const d = deriveDrift(feature, sheet([['F', '25'], ['A', '75']]))!;
    const generic = driftView(d, false, () => 'Name');
    expect(generic).toEqual({ kind: 'master', drifted: true });
    const detail = driftView(d, true, (id) => `Name ${id}`);
    expect(detail.items?.[0]).toEqual({ partyId: 'F', name: 'Name F', code: 'differs', contract: '30', sheet: '25' });
  });
});

describe('canSignContract', () => {
  const base = { contract: { type: 'feature' as const, trackId: 'song-1' } };
  it('is never blocked when the setting is off', () => {
    expect(canSignContract({ ...base, requireSignedMasterSplit: false, masterSheets: [] })).toEqual({ ok: true });
  });
  it('is blocked until the master sheet is signed, and says which stage it is at', () => {
    const none = canSignContract({ ...base, requireSignedMasterSplit: true, masterSheets: [] });
    expect(none).toMatchObject({ ok: false, code: 'master_split_not_signed' });
    expect((none as { error: string }).error).toContain('no master split sheet');
    expect((canSignContract({ ...base, requireSignedMasterSplit: true, masterSheets: [{ status: 'draft' }] }) as { error: string }).error).toContain('still a draft');
    expect((canSignContract({ ...base, requireSignedMasterSplit: true, masterSheets: [{ status: 'circulated' }] }) as { error: string }).error).toContain('not been signed');
    expect(canSignContract({ ...base, requireSignedMasterSplit: true, masterSheets: [{ status: 'superseded' }, { status: 'signed' }] })).toEqual({ ok: true });
  });
  it('does not apply to a contract with no master rule or no song', () => {
    expect(canSignContract({ requireSignedMasterSplit: true, contract: { type: 'producer', trackId: 'song-1' }, masterSheets: [] })).toEqual({ ok: true });
    expect(canSignContract({ requireSignedMasterSplit: true, contract: { type: 'feature', trackId: null }, masterSheets: [] })).toEqual({ ok: true });
  });
});
