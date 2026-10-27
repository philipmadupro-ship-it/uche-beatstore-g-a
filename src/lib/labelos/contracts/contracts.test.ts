import { describe, expect, it } from 'vitest';
import { cleanFields, classifyKey, fieldKeysIn, MERGE_FIELDS, tokensIn, unknownTokens } from './merge-fields';
import { canTransition, isEditable, TEMPLATE_TYPE_IDS, PARTY_ROLES } from './types';
import { NOT_LEGAL_ADVICE, platformSource, platformTemplate, platformTemplates } from './templates';
import { fieldKeysOf, renderClauses, renderSample, sampleContext } from './render';
import { changedClauseIds, cleanTemplateEdit, sameClauses } from './template-edit';
import { mayReadContract, readsAllContracts, type ContractActor } from './access';

describe('platform templates', () => {
  it('has a template for each of the 14 types', () => {
    expect(TEMPLATE_TYPE_IDS).toHaveLength(14);
    expect(platformTemplates().map((t) => t.type)).toEqual([...TEMPLATE_TYPE_IDS]);
  });

  for (const t of platformTemplates()) {
    describe(t.type, () => {
      it('is marked not legal advice in its first clause', () => {
        expect(t.clauses[0].id).toBe('notice');
        expect(t.clauses[0].body).toContain(NOT_LEGAL_ADVICE);
      });
      it('uses only known merge fields and party roles of its own slots', () => {
        const slotRoles = new Set(t.slots.map((s) => s.role));
        for (const c of t.clauses) {
          expect(unknownTokens(`${c.heading} ${c.body}`), c.id).toEqual([]);
          for (const k of tokensIn(c.body)) {
            const kind = classifyKey(k);
            if (kind?.type === 'party') expect(slotRoles.has(kind.role), `${t.type} ${k}`).toBe(true);
          }
        }
      });
      it('renders with sample data and leaves nothing missing', () => {
        const r = renderSample(t);
        expect(r.missing).toEqual([]);
        expect(r.clauses.map((c) => c.body).join('\n')).not.toMatch(/\{\{|\[\w/);
      });
      it('has unique clause ids, a required party slot and suggested fields that appear in the text', () => {
        expect(new Set(t.clauses.map((c) => c.id)).size).toBe(t.clauses.length);
        expect(t.slots.some((s) => s.required)).toBe(true);
        const used = fieldKeysOf(t.clauses);
        for (const f of t.suggestedFields) expect(used, f).toContain(f);
      });
    });
  }

  it('records the version a contract is made from', () => {
    expect(platformSource('nda')).toBe(`platform:nda@${platformTemplate('nda').version}`);
  });
});

describe('merge fields', () => {
  it('classifies keys', () => {
    expect(classifyKey('advance')?.type).toBe('field');
    expect(classifyKey('contract.term')?.type).toBe('builtin');
    expect(classifyKey('party.label.address')).toMatchObject({ type: 'party', role: 'label', address: true });
    expect(classifyKey('party.nobody')).toBeNull();
    expect(classifyKey('tax_id')).toBeNull();
    expect(classifyKey('party.label.tax_id')).toBeNull();
  });
  it('no merge field or party key can reach payee data', () => {
    for (const f of MERGE_FIELDS) expect(f.key).not.toMatch(/tax|payment|iban|bank/);
    expect(PARTY_ROLES.length).toBeGreaterThan(0);
  });
  it('finds unknown tokens and field keys', () => {
    expect(unknownTokens('a {{nope}} b {{advance}}')).toEqual(['nope']);
    expect(fieldKeysIn('{{advance}} {{contract.term}} {{party.label}}')).toEqual(['advance']);
  });
  it('validates fields by kind, strings only, no floats', () => {
    expect(cleanFields({ advance: ' 2500.50 ', currency: 'USD', royalty_rate: '18.5', delivery_date: '2027-03-01', option_periods: '2' })).toEqual({
      ok: true,
      fields: { advance: '2500.50', currency: 'USD', royalty_rate: '18.5', delivery_date: '2027-03-01', option_periods: '2' },
    });
    for (const bad of [{ advance: '12.345' }, { royalty_rate: '100.5' }, { royalty_rate: '-1' }, { currency: 'usd' }, { delivery_date: '2027-02-30' }, { option_periods: '1.5' }, { nope: 'x' }, { advance: 5 }]) {
      expect(cleanFields(bad as Record<string, unknown>).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(cleanFields({ advance: '', exclusivity: '  ' })).toEqual({ ok: true, fields: {} });
  });
});

describe('renderClauses', () => {
  it('shows missing values as [Label] and reports them', () => {
    const r = renderClauses([{ id: 'a', heading: 'H', body: 'Pay {{advance}} to {{party.artist}}' }], { builtins: {}, parties: {}, fields: {} });
    expect(r.clauses[0].body).toBe('Pay [Advance] to [Artist]');
    expect(r.missing).toEqual(['advance', 'party.artist']);
  });
  it('merges names, addresses and joins several parties', () => {
    const ctx = { ...sampleContext([{ role: 'collaborator', label: 'x', required: true, many: true }]), fields: {} };
    const r = renderClauses([{ id: 'a', heading: 'H', body: '{{party.collaborator}} / {{party.collaborator.address}}' }], ctx);
    expect(r.clauses[0].body).toContain('Sample Collaborator 1, Sample Collaborator 2');
  });
});

describe('template editor rules', () => {
  const ok = { name: 'Mine', clauses: [{ heading: 'A', body: 'Pay {{advance}}' }, { id: 'x', heading: 'B', body: 'text' }] };
  it('accepts and mints ids', () => {
    const r = cleanTemplateEdit(ok);
    expect(r.ok && r.clauses.map((c) => c.id)).toEqual(['clause-1', 'x']);
  });
  it('refuses unknown merge fields, empties and long text', () => {
    expect(cleanTemplateEdit({ name: 'M', clauses: [{ heading: 'A', body: '{{tax_id}}' }] }).ok).toBe(false);
    expect(cleanTemplateEdit({ name: ' ', clauses: ok.clauses }).ok).toBe(false);
    expect(cleanTemplateEdit({ name: 'M', clauses: [] }).ok).toBe(false);
    expect(cleanTemplateEdit({ name: 'M', clauses: [{ heading: 'A', body: 'x'.repeat(6001) }] }).ok).toBe(false);
  });
  it('detects no-op edits and lists changed ids, never words', () => {
    const a = [{ id: 'a', heading: 'H', body: 'one' }, { id: 'b', heading: 'H', body: 'two' }];
    expect(sameClauses(a, a.map((c) => ({ ...c })))).toBe(true);
    expect(changedClauseIds(a, [a[0], { id: 'b', heading: 'H', body: 'changed' }, { id: 'c', heading: 'N', body: 'n' }])).toEqual(['b', 'c']);
  });
});

describe('status', () => {
  it('moves only along the table', () => {
    expect(canTransition('draft', 'void')).toBe(true);
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('void', 'draft')).toBe(false);
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('sent')).toBe(false);
  });
});

describe('mayReadContract', () => {
  const C1 = '11111111-1111-4111-8111-111111111111';
  const C2 = '22222222-2222-4222-8222-222222222222';
  const staff = (scope: ContractActor['artistScope']): ContractActor => ({ role: 'member', capabilities: new Set(['contracts.read']), artistScope: scope, ownPartyIds: new Set() });
  const artist: ContractActor = { role: 'artist', capabilities: new Set(['rights.read']), artistScope: new Set([C1]), ownPartyIds: new Set(['p1']) };
  const row = (o: Partial<{ status: 'draft' | 'sent'; artist_contact_id: string | null; partyIds: string[] }> = {}) => ({ status: 'sent' as const, artist_contact_id: C1, partyIds: [], ...o });

  it('staff read by scope; a contract with no artist is whole-org only', () => {
    expect(mayReadContract(staff(null), row({ artist_contact_id: null }))).toBe(true);
    expect(mayReadContract(staff(new Set([C1])), row())).toBe(true);
    expect(mayReadContract(staff(new Set([C1])), row({ artist_contact_id: C2 }))).toBe(false);
    expect(mayReadContract(staff(new Set([C1])), row({ artist_contact_id: null }))).toBe(false);
  });
  it('a roster artist reads their own contracts once sent, never drafts or others', () => {
    expect(mayReadContract(artist, row())).toBe(true);
    expect(mayReadContract(artist, row({ status: 'draft' }))).toBe(false);
    expect(mayReadContract(artist, row({ artist_contact_id: C2 }))).toBe(false);
    expect(mayReadContract(artist, row({ artist_contact_id: C2, partyIds: ['p1'] }))).toBe(true);
  });
  it('contracts.read never admits role artist', () => {
    expect(readsAllContracts({ role: 'artist', capabilities: new Set(['contracts.read']) })).toBe(false);
  });
  it('a member without contracts.read who is a party reads their own', () => {
    const m: ContractActor = { role: 'member', capabilities: new Set(), artistScope: null, ownPartyIds: new Set(['p9']) };
    expect(mayReadContract(m, row({ partyIds: ['p9'], artist_contact_id: null }))).toBe(true);
    expect(mayReadContract(m, row({ partyIds: ['p8'] }))).toBe(false);
  });
});
