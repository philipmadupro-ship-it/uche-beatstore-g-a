import { describe, expect, it } from 'vitest';
import { externalActor, orgActor } from './credits';
import { capabilitiesFor } from './capabilities';
import {
  FULL_SHARE,
  ROLES_BY_KIND,
  SPLIT_ROLES,
  canTransition,
  draftIssues,
  evenShares,
  formatShare,
  isEditable,
  isLive,
  parseShare,
  planSignature,
  sheetView,
  shareToDb,
  suggestRemainder,
  sumShares,
  unitsOf,
  validateSheet,
  type SplitLineRow,
  type SplitPartyFacts,
  type SplitSheetRow,
} from './splits';

const U = (pct: string) => parseShare(pct)!;
const line = (partyId: string, role: string, pct: string) => ({ partyId, role, units: U(pct) });

describe('parseShare / formatShare (integer units, no floats)', () => {
  it('reads up to four decimals exactly', () => {
    expect(parseShare('33.3333')).toBe(333_333);
    expect(parseShare('100')).toBe(FULL_SHARE);
    expect(parseShare('0.0001')).toBe(1);
    expect(parseShare('12.5')).toBe(125_000);
    expect(parseShare(50)).toBe(500_000);
    expect(parseShare(' 7 ')).toBe(70_000);
  });

  it('refuses anything that is not a share', () => {
    for (const bad of ['', ' ', 'abc', '-1', '+5', '1e2', '33,5', '1.23456', '100.0001', '101', '1000', '.5', '5.', 'NaN', null, undefined]) {
      expect(parseShare(bad as string), String(bad)).toBeNull();
    }
    expect(parseShare(Number.NaN)).toBeNull();
    expect(parseShare(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseShare(1e-7)).toBeNull(); // String(1e-7) is "1e-7"
  });

  it('round-trips through the database form and the display form', () => {
    for (const u of [1, 333_333, 333_334, 500_000, 1_000_000, 125_000, 999_999]) {
      expect(parseShare(shareToDb(u))).toBe(u);
    }
    expect(shareToDb(500_000)).toBe('50.0000');
    expect(shareToDb(1)).toBe('0.0001');
    expect(formatShare(500_000)).toBe('50');
    expect(formatShare(FULL_SHARE)).toBe('100');
    expect(formatShare(333_333)).toBe('33.3333');
    expect(formatShare(125_000)).toBe('12.5');
    expect(formatShare(1)).toBe('0.0001');
    expect(formatShare(100_000)).toBe('10');
  });

  it('numeric(7,4) answers as a JSON number: unitsOf reads it exactly', () => {
    expect(unitsOf(33.3333)).toBe(333_333);
    expect(unitsOf(0.1)).toBe(1_000);
    expect(unitsOf('66.6667')).toBe(666_667);
    expect(unitsOf(100)).toBe(FULL_SHARE);
  });
});

describe('validateSheet: the 100.0000 rule, composition and master separately', () => {
  it('33.3333 x 3 cannot circulate, and the error names the missing 0.0001', () => {
    const r = validateSheet('composition', [line('a', 'writer', '33.3333'), line('b', 'writer', '33.3333'), line('c', 'writer', '33.3333')]);
    expect(r.ok).toBe(false);
    expect(r.total).toBe(999_999);
    expect(r.remaining).toBe(1);
    const total = r.issues.find((i) => i.code === 'total');
    expect(total && 'missing' in total ? total.missing : null).toBe(1);
    expect(total?.message).toBe('The shares add up to 99.9999%; 0.0001% is still unassigned.');
  });

  it('33.3334 + 33.3333 + 33.3333 is exactly 100', () => {
    const r = validateSheet('composition', [line('a', 'writer', '33.3334'), line('b', 'writer', '33.3333'), line('c', 'writer', '33.3333')]);
    expect(r).toMatchObject({ ok: true, total: FULL_SHARE, remaining: 0, issues: [] });
  });

  it('0.1 + 0.2 style sums are exact: ten lines of 10 and three of 33.3333 + 0.0001', () => {
    const ten = Array.from({ length: 10 }, (_, i) => line(`p${i}`, 'writer', '10'));
    expect(validateSheet('composition', ten).ok).toBe(true);
    const odd = [line('a', 'writer', '0.1'), line('b', 'writer', '0.2'), line('c', 'writer', '99.7')];
    expect(validateSheet('composition', odd).ok).toBe(true);
  });

  it('over 100 is refused and says by how much', () => {
    const r = validateSheet('composition', [line('a', 'writer', '60'), line('b', 'writer', '40.0001')]);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(-1);
    expect(r.issues[0].message).toBe('The shares add up to 100.0001%; that is 0.0001% too much.');
  });

  it('an empty sheet, a zero share and a duplicate person-and-role are each refused', () => {
    expect(validateSheet('composition', []).issues.map((i) => i.code)).toEqual(['no_lines']);
    expect(validateSheet('composition', [{ partyId: 'a', role: 'writer', units: 0 }, line('b', 'writer', '100')]).issues.map((i) => i.code)).toContain('bad_share');
    const dup = validateSheet('composition', [line('a', 'writer', '50'), line('a', 'writer', '50')]);
    expect(dup.issues.map((i) => i.code)).toEqual(['duplicate']);
  });

  it('the same person may hold two different roles (writer and publisher)', () => {
    expect(validateSheet('composition', [line('a', 'writer', '50'), line('a', 'publisher', '50')]).ok).toBe(true);
  });

  it('roles belong to their kind: a master sheet takes master_owner only, a composition sheet never does', () => {
    expect(ROLES_BY_KIND.master).toEqual(['master_owner']);
    expect(validateSheet('master', [line('a', 'master_owner', '100')]).ok).toBe(true);
    expect(validateSheet('master', [line('a', 'writer', '100')]).issues.map((i) => i.code)).toEqual(['bad_role']);
    expect(validateSheet('composition', [line('a', 'master_owner', '100')]).issues.map((i) => i.code)).toEqual(['bad_role']);
    // Every role belongs to exactly one kind.
    for (const role of SPLIT_ROLES) {
      expect(Object.values(ROLES_BY_KIND).filter((roles) => (roles as readonly string[]).includes(role))).toHaveLength(1);
    }
  });

  it('composition and master totals are independent: 100 on one proves nothing about the other', () => {
    const comp = validateSheet('composition', [line('a', 'writer', '100')]);
    const master = validateSheet('master', [line('a', 'master_owner', '99.9999')]);
    expect(comp.ok).toBe(true);
    expect(master.ok).toBe(false);
  });

  it('a draft may be incomplete: draftIssues ignores the total and the empty sheet, but not a bad line', () => {
    expect(draftIssues('composition', [])).toEqual([]);
    expect(draftIssues('composition', [line('a', 'writer', '30')])).toEqual([]);
    expect(draftIssues('composition', [line('a', 'master_owner', '30')]).map((i) => i.code)).toEqual(['bad_role']);
  });
});

describe('suggestRemainder ("Add remainder") and evenShares', () => {
  it('suggests exactly what is missing, or nothing when full or over', () => {
    expect(suggestRemainder([])).toBe(FULL_SHARE);
    expect(suggestRemainder([{ units: U('33.3333') }, { units: U('33.3333') }])).toBe(U('33.3334'));
    expect(suggestRemainder([{ units: U('60') }, { units: U('40') }])).toBeNull();
    expect(suggestRemainder([{ units: U('70') }, { units: U('40') }])).toBeNull();
  });

  it('adding the suggestion always lands on exactly 100', () => {
    const rest = [{ units: U('12.3456') }, { units: U('7.7777') }, { units: U('0.0001') }];
    const add = suggestRemainder(rest)!;
    expect(sumShares([...rest.map((r) => r.units), add])).toBe(FULL_SHARE);
  });

  it('evenShares sum to exactly 100 for any count, the leftover going to the first lines', () => {
    expect(evenShares(3).map(shareToDb)).toEqual(['33.3334', '33.3333', '33.3333']);
    expect(evenShares(2)).toEqual([500_000, 500_000]);
    for (let n = 1; n <= 40; n += 1) {
      const shares = evenShares(n);
      expect(shares).toHaveLength(n);
      expect(sumShares(shares)).toBe(FULL_SHARE);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
    expect(evenShares(0)).toEqual([]);
    expect(evenShares(1.5)).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('allows draft → circulated → signed | disputed | superseded, and signed | disputed → superseded; nothing goes back', () => {
    expect(canTransition('draft', 'circulated')).toBe(true);
    expect(canTransition('circulated', 'signed')).toBe(true);
    expect(canTransition('circulated', 'superseded')).toBe(true);
    expect(canTransition('signed', 'superseded')).toBe(true);
    expect(canTransition('disputed', 'superseded')).toBe(true);
    expect(canTransition('circulated', 'draft')).toBe(false);
    expect(canTransition('signed', 'circulated')).toBe(false);
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('superseded', 'circulated')).toBe(false);
  });

  it('only a draft is editable; circulated, signed and disputed are in force', () => {
    expect(isEditable('draft')).toBe(true);
    for (const s of ['circulated', 'signed', 'superseded', 'disputed']) expect(isEditable(s), s).toBe(false);
    expect(['circulated', 'signed', 'disputed'].every(isLive)).toBe(true);
    expect(isLive('draft') || isLive('superseded')).toBe(false);
  });
});

const caps = (role: string, functions: string[] = []) => capabilitiesFor('label', role, functions);
const owner = orgActor('u-owner', caps('owner'));
const aAndR = orgActor('u-ar', caps('member', ['a_and_r']));
const producer = orgActor('u-prd', caps('member', ['producer']));
const marketing = orgActor('u-mk', caps('member', ['marketing']));

describe('planSignature', () => {
  const mine = { partyUserId: 'u-prd', signed: false };
  const theirs = { partyUserId: 'u-other', signed: false };

  it('a person acknowledges their own line, on a circulated sheet', () => {
    expect(planSignature(producer, 'acknowledged', 'circulated', mine)).toEqual({ ok: true });
  });

  it('nobody acknowledges for someone else — not even a rights writer', () => {
    expect(planSignature(owner, 'acknowledged', 'circulated', theirs)).toMatchObject({ ok: false, status: 403 });
  });

  it('a line that is not yours is 404 when you cannot write rights (it does not exist for you)', () => {
    expect(planSignature(producer, 'acknowledged', 'circulated', theirs)).toMatchObject({ ok: false, status: 404 });
    expect(planSignature(marketing, 'acknowledged', 'circulated', theirs)).toMatchObject({ ok: false, status: 404 });
  });

  it('uploading a signed PDF is a rights writer’s act, never the line owner’s', () => {
    expect(planSignature(owner, 'upload', 'circulated', theirs)).toEqual({ ok: true });
    expect(planSignature(producer, 'upload', 'circulated', mine)).toMatchObject({ ok: false, status: 403 });
  });

  it('an external project member can acknowledge their own line and never upload', () => {
    const ext = externalActor('u-prd', 'editor');
    expect(planSignature(ext, 'acknowledged', 'circulated', mine)).toEqual({ ok: true });
    expect(planSignature(ext, 'upload', 'circulated', mine)).toMatchObject({ ok: false, status: 403 });
    expect(planSignature(ext, 'acknowledged', 'circulated', theirs)).toMatchObject({ ok: false, status: 404 });
  });

  it('only a circulated sheet takes signatures; a signed line is final', () => {
    expect(planSignature(owner, 'upload', 'draft', theirs)).toMatchObject({ ok: false, status: 409 });
    for (const s of ['signed', 'superseded', 'disputed']) expect(planSignature(owner, 'upload', s, theirs), s).toMatchObject({ ok: false, status: 409 });
    expect(planSignature(producer, 'acknowledged', 'circulated', { ...mine, signed: true })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('sheetView: who sees which lines', () => {
  const sheet: SplitSheetRow = {
    id: 's1', track_id: 't1', kind: 'composition', version: 2, status: 'circulated', note: 'internal remark',
    document_asset_id: 'asset-key-1', created_by: 'u-owner', created_at: '2026-10-01', circulated_at: '2026-10-02', signed_at: null,
    superseded_at: null, superseded_by: null,
  };
  const lines: SplitLineRow[] = [
    { id: 'l1', split_sheet_id: 's1', party_id: 'pa', role: 'writer', share: 66.6667, signed_at: null, signature_method: null, signature_asset_id: null },
    { id: 'l2', split_sheet_id: 's1', party_id: 'pb', role: 'publisher', share: '33.3333', signed_at: '2026-10-03', signature_method: 'acknowledged', signature_asset_id: null },
  ];
  const parties = new Map<string, SplitPartyFacts>([
    ['pa', { id: 'pa', display_name: 'Prd Person', legal_name: 'Pierre Producteur', ipi: '00123456789', user_id: 'u-prd' }],
    ['pb', { id: 'pb', display_name: 'Nova', legal_name: 'Nova Okafor', ipi: '00987654321', user_id: null }],
  ]);

  it('rights.read sees every line, the exact total, the progress and the legal identifiers', () => {
    const v = sheetView(sheet, lines, parties, aAndR);
    expect(v.lines.map((l) => [l.name, l.share])).toEqual([['Prd Person', '66.6667'], ['Nova', '33.3333']]);
    expect(v.total).toBe('100');
    expect([v.signedCount, v.lineCount]).toEqual([1, 2]);
    expect(v.lines[1]).toMatchObject({ legalName: 'Nova Okafor', ipi: '00987654321', signed: true, signatureMethod: 'acknowledged' });
    expect(v.hasDocument).toBe(true);
    expect(v.note).toBe('internal remark');
    // A&R reads rights but does not write them; the owner can start the next version of a circulated sheet.
    expect(v.can).toEqual({ edit: false, circulate: false, supersede: false });
    expect(sheetView(sheet, lines, parties, owner).can).toEqual({ edit: false, circulate: false, supersede: true });
  });

  it('an own-line reader gets their line only: no other name, share, total, note, document or count', () => {
    const v = sheetView(sheet, lines, parties, producer);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ name: 'Prd Person', share: '66.6667', mine: true, role: 'writer' });
    expect(v.total).toBeUndefined();
    expect(v.signedCount).toBeUndefined();
    expect(v.lineCount).toBeUndefined();
    expect(v.note).toBeNull();
    expect(v.hasDocument).toBe(false);
    const wire = JSON.stringify(v);
    for (const leak of ['Nova', 'Okafor', '00987654321', '33.3333', 'internal remark', 'asset-key-1', 'u-owner', 'pb']) expect(wire, leak).not.toContain(leak);
    expect(v.can).toEqual({ edit: false, circulate: false, supersede: false });
    expect(v.lines[0].can.acknowledge).toBe(true);
  });

  it('a roster artist sees names, roles and shares of the whole sheet — no co-writer legal data, no note, no document', () => {
    const artist = orgActor('u-art', capabilitiesFor('label', 'artist', []), 'artist');
    const v = sheetView(sheet, lines, parties, artist);
    expect(v.lines.map((l) => [l.name, l.role, l.share])).toEqual([['Prd Person', 'writer', '66.6667'], ['Nova', 'publisher', '33.3333']]);
    expect(v.total).toBe('100');
    expect(v.note).toBeNull();
    expect(v.hasDocument).toBe(false);
    const wire = JSON.stringify(v);
    for (const leak of ['Okafor', 'Producteur', '00987654321', '00123456789', 'internal remark', 'asset-key-1']) expect(wire, leak).not.toContain(leak);
  });

  it('their own legal identifiers are theirs to read', () => {
    const v = sheetView(sheet, lines, parties, producer);
    expect(v.lines[0]).toMatchObject({ legalName: 'Pierre Producteur', ipi: '00123456789' });
  });

  it('a member with neither ability sees no lines at all', () => {
    const v = sheetView(sheet, lines, parties, marketing);
    expect(v.lines).toEqual([]);
    expect(v.total).toBeUndefined();
  });

  it('only a rights writer can edit or circulate, and only a draft', () => {
    const draft = { ...sheet, status: 'draft' };
    expect(sheetView(draft, lines, parties, owner).can).toEqual({ edit: true, circulate: true, supersede: false });
    expect(sheetView(draft, lines, parties, aAndR).can.edit).toBe(false);
  });

  it('builds the view field by field: no creator id, no file key', () => {
    const wire = JSON.stringify(sheetView(sheet, lines, parties, owner));
    for (const leak of ['created_by', 'u-owner', 'document_asset_id', 'asset-key-1', 'superseded_by']) expect(wire, leak).not.toContain(leak);
  });
});
