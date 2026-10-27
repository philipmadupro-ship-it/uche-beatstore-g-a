import { describe, expect, it } from 'vitest';
import { bodyFromContractForm, contractFormError, emptyContractForm, formFromContract, parseTerritories } from './contracts-form';
import { platformTemplate } from './contracts/templates';

const slots = platformTemplate('recording').slots;

describe('contract form', () => {
  it('parses territories', () => {
    expect(parseTerritories('')).toBeNull();
    expect(parseTerritories('gb, fr;  de')).toEqual(['GB', 'FR', 'DE']);
    expect(parseTerritories('ww')).toEqual(['WW']);
  });

  it('reports the first problem', () => {
    const f = emptyContractForm();
    expect(contractFormError(f, slots)).toMatch(/title/);
    f.title = 'T';
    expect(contractFormError(f, slots)).toBeNull();
    expect(contractFormError({ ...f, termMonths: '2x' }, slots)).toMatch(/months/);
    expect(contractFormError({ ...f, territories: 'England' }, slots)).toMatch(/two-letter/);
    expect(contractFormError({ ...f, territories: 'WW, GB' }, slots)).toMatch(/on its own/);
    expect(contractFormError({ ...f, effectiveDate: '1/1/27' }, slots)).toMatch(/2027-03-01/);
    expect(contractFormError({ ...f, fields: { advance: 'lots' } }, slots)).toMatch(/amount/);
    expect(contractFormError({ ...f, parties: { label: ['a', 'b'] } }, slots)).toMatch(/one label/i);
  });

  it('builds the body and round-trips a contract', () => {
    const f = { ...emptyContractForm(), title: ' Deal ', artistId: 'c1', termMonths: '24', territories: 'ww', fields: { advance: ' 100 ', royalty_rate: '' }, parties: { label: ['p1'], artist: ['p2'] } };
    expect(bodyFromContractForm(f)).toEqual({
      title: 'Deal', artist_contact_id: 'c1', track_id: null, release_id: null, effective_date: null, term_months: 24, territories: ['WW'],
      fields: { advance: '100' }, parties: [{ party_id: 'p1', role: 'label' }, { party_id: 'p2', role: 'artist' }], internal_note: null,
    });
    const back = formFromContract({ title: 'Deal', artist_contact_id: 'c1', track_id: null, release_id: null, effective_date: null, term_months: 24, territories: ['WW'], fields: { advance: '100' }, parties: [{ party_id: 'p1', role: 'label' }] });
    expect(back).toMatchObject({ artistId: 'c1', termMonths: '24', territories: 'WW', parties: { label: ['p1'] } });
  });
});
