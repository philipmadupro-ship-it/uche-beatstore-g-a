import { describe, it, expect } from 'vitest';
import {
  SCHEDULE_HEADING, buildLicenseContract, previewTemplate, resolveContractTiers, scheduleLines, verifyContractTerms,
  type ResolvedTier,
} from './license-contract';
import { DEFAULT_TEMPLATE_MD, SAMPLE_VARIABLES, TIER_AWARE_TEMPLATE_MD } from './license-template';
import { legacyTierTerms, type TierTerms } from './license-terms';

const UID = '11111111-1111-4111-8111-111111111111';
const mk = (p: Partial<TierTerms> = {}): TierTerms => ({
  name: 'Premium', file_types: ['MP3', 'WAV'], stems_included: false, is_exclusive: false,
  streaming_limit: 100000, distribution_limit: 50000, commercial_rights: true, sync_rights: false,
  broadcast_rights: null, credit_required: true, ...p,
});
const rt = (t: TierTerms, source: ResolvedTier['source'] = 'licenses-row'): ResolvedTier => ({ terms: t, source, issues: [] });
const vars = { ...SAMPLE_VARIABLES, license_type: 'Lease' };

const TIERS: Array<[string, TierTerms]> = [
  ['lease mp3', mk({ name: 'Lease', file_types: ['MP3'], streaming_limit: 5000, distribution_limit: 5000 })],
  ['premium wav', mk()],
  ['wav+stems', mk({ name: 'Stems', file_types: ['WAV', 'STEMS'], stems_included: true })],
  ['unlimited', mk({ name: 'Unlimited', streaming_limit: null, distribution_limit: null })],
  ['exclusive', mk({ name: 'Exclusive', is_exclusive: true, stems_included: true, file_types: ['MP3', 'WAV', 'STEMS'], streaming_limit: null, distribution_limit: null })],
  ['all rights', mk({ name: 'All', commercial_rights: true, sync_rights: true, broadcast_rights: true, credit_required: false })],
  ['no rights', mk({ name: 'None', commercial_rights: false, sync_rights: false, broadcast_rights: false })],
  ['unspecified rights', mk({ name: 'Old', commercial_rights: null, sync_rights: null, broadcast_rights: null })],
  ['flac midi project', mk({ name: 'Producer pack', file_types: ['FLAC', 'MIDI', 'PROJECT'] })],
  ['one stream', mk({ name: 'Tiny', streaming_limit: 1, distribution_limit: 1 })],
];
const TEMPLATES: Array<[string, string | null]> = [
  ['empty', ''], ['whitespace', '  \n '], ['tier-aware', TIER_AWARE_TEMPLATE_MD],
  ['default', DEFAULT_TEMPLATE_MD], ['custom plain', '# Deal\n\n{{buyer_name}} bought {{track_titles}}.'],
];

describe('buildLicenseContract: every tier x template states the selected terms', () => {
  for (const [tn, terms] of TIERS) {
    for (const [pn, template] of TEMPLATES) {
      it(`${tn} / ${pn}`, () => {
        const b = buildLicenseContract({ template, vars, tiers: [rt(terms)] });
        expect(b.verification.missing).toEqual([]);
        for (const line of scheduleLines(terms, vars.producer_name)) expect(b.text).toContain(line);
        expect(b.text).toContain('this schedule governs');
        expect(b.text).not.toMatch(/\{\{/);
      });
    }
  }
  it('flags only on explicit true, null rights read as "not specified"', () => {
    const b = buildLicenseContract({ template: '{{#if sync_rights}}\nSYNC OK\n{{/if}}\n{{#if commercial_rights}}\nCOMM OK\n{{/if}}', vars, tiers: [rt(mk({ sync_rights: null, commercial_rights: true }))] });
    expect(b.text).not.toContain('SYNC OK');
    expect(b.text).toContain('COMM OK');
    expect(b.text).toContain('Sync / film: Not specified');
  });
});

describe('empty template', () => {
  it('uses the tier-aware default, never the hardcoded 5,000-stream one', () => {
    const b = buildLicenseContract({ template: '', vars, tiers: [rt(mk())] });
    expect(b.snapshot.template_source).toBe('tier-aware');
    expect(b.snapshot.template_used).toBe(TIER_AWARE_TEMPLATE_MD);
    expect(b.text).toContain('100,000 streams');
    expect(b.text).not.toContain('5,000');
    expect(b.bodyConflicts).toEqual([]);
  });
  it('DEFAULT_TEMPLATE_MD is still exported unchanged in kind', () => {
    expect(DEFAULT_TEMPLATE_MD).toContain('Up to 5,000 audio streams');
  });
});

describe('custom wording that contradicts the tier', () => {
  it('detects hardcoded streams, MP3-only delivery and stems promises, and the schedule still states the truth', () => {
    const tpl = 'Up to 5,000 audio streams.\nOnly an MP3 file is delivered.\nStems are included.\n';
    const b = buildLicenseContract({ template: tpl, vars, tiers: [rt(mk({ file_types: ['WAV'] }))] });
    expect(b.bodyConflicts.join('\n')).toMatch(/5,000 streams/);
    expect(b.bodyConflicts.join('\n')).toMatch(/MP3 delivery/);
    expect(b.bodyConflicts.join('\n')).toMatch(/stems/);
    expect(b.alerts.length).toBeGreaterThan(0);
    expect(b.text).toContain('Files delivered: WAV');
    expect(b.verification.missing).toEqual([]);
  });
  it('does not fire when the prose matches the tier', () => {
    const b = buildLicenseContract({ template: 'Up to 100,000 audio streams.\nWAV files are delivered.', vars, tiers: [rt(mk({ file_types: ['WAV'] }))] });
    expect(b.bodyConflicts).toEqual([]);
  });
  it('an exclusive tier on a template with no exclusivity wording still states exclusivity in the schedule', () => {
    const b = buildLicenseContract({ template: '# Deal', vars, tiers: [rt(mk({ is_exclusive: true }))] });
    expect(b.text).toContain('License: Premium (Exclusive)');
    expect(b.text).toContain('will not re-sell or re-list');
  });
  it('a non-exclusive tier under wording that promises exclusivity is a conflict', () => {
    const b = buildLicenseContract({ template: 'The Producer will not re-sell or re-list the work.', vars, tiers: [rt(mk())] });
    expect(b.bodyConflicts.join()).toMatch(/exclusivity/);
  });
});

describe('verifyContractTerms', () => {
  const tiers = [rt(mk())];
  const text = buildLicenseContract({ template: '', vars, tiers }).text;
  it('passes the generated text', () => expect(verifyContractTerms(text, tiers, vars.producer_name).ok).toBe(true));
  it('catches a tampered schedule line', () => {
    const at = text.indexOf(SCHEDULE_HEADING);
    const tampered = text.slice(0, at) + text.slice(at).replace('100,000 streams', '1,000,000 streams');
    const v = verifyContractTerms(tampered, tiers, vars.producer_name);
    expect(v.ok).toBe(false);
    expect(v.missing.join()).toMatch(/Audio streams/);
  });
  it('catches a missing schedule', () => {
    const v = verifyContractTerms(text.slice(0, text.indexOf(SCHEDULE_HEADING)), tiers, vars.producer_name);
    expect(v.missing).toContain('Schedule of Terms');
  });
  it('catches a missing tier block', () => {
    expect(verifyContractTerms(text, [...tiers, rt(mk({ name: 'Other' }))], vars.producer_name).missing.join()).toMatch(/Other: tier block/);
  });
});

describe('multi-tier carts', () => {
  const tiers = [rt(mk({ name: 'Lease', file_types: ['MP3'], streaming_limit: 5000 })), rt(mk({ name: 'Exclusive', is_exclusive: true, streaming_limit: null }))];
  it('states each tier in its own block and de-duplicates identical lines', () => {
    const b = buildLicenseContract({ template: '', vars, tiers: [...tiers, tiers[0]] });
    expect(b.text.match(/### Lease/g)).toHaveLength(1);
    expect(b.text).toContain('### Exclusive');
    expect(b.verification.missing).toEqual([]);
    expect(b.bodyConflicts).toEqual([]);
  });
});

describe('resolveContractTiers', () => {
  const line = { license_id: UID, license_type: 'lease' as const };
  const row = { id: UID, name: 'Premium', is_exclusive: false, file_types: ['mp3', 'wav'], stems_included: false, streaming_limit: 100000, distribution_limit: null, commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: true };
  it('uses the stored snapshot before the live row', () => {
    const r = resolveContractTiers([{ ...line, terms: mk({ streaming_limit: 7 }) }], new Map([[UID, { ...row, streaming_limit: 999 }]]));
    expect(r[0].source).toBe('snapshot');
    expect(r[0].terms.streaming_limit).toBe(7);
  });
  it('reads a valid row', () => {
    const r = resolveContractTiers([line], new Map([[UID, row]]));
    expect(r[0]).toMatchObject({ source: 'licenses-row', issues: [] });
    expect(r[0].terms.file_types).toEqual(['MP3', 'WAV']);
  });
  const corrupt: Array<[string, Record<string, unknown>]> = [
    ['NaN limit', { streaming_limit: NaN }], ['negative limit', { distribution_limit: -1 }],
    ['unknown file type', { file_types: ['MP3', 'OGG'] }], ['string rights', { sync_rights: 'no' }],
  ];
  it.each(corrupt)('%s: falls back, flags it, and never becomes "Unlimited"', (_n, patch) => {
    const r = resolveContractTiers([line], new Map([[UID, { ...row, ...patch }]]));
    expect(r[0].source).toBe('fallback');
    expect(r[0].issues.length).toBeGreaterThan(0);
    expect(r[0].terms.streaming_limit).toBe(legacyTierTerms('lease').streaming_limit);
    const b = buildLicenseContract({ template: '', vars, tiers: r });
    expect(b.alerts.join()).toMatch(/standard terms were used/);
    expect(b.text).toContain('could not be confirmed');
  });
  it('unreadable rows on a UUID license fall back flagged; a legacy id does not', () => {
    expect(resolveContractTiers([line], null)[0]).toMatchObject({ source: 'fallback' });
    const l = resolveContractTiers([{ license_id: 'exclusive', license_type: 'exclusive' }], null)[0];
    expect(l).toMatchObject({ source: 'legacy', issues: [] });
  });
  it('the fallback keeps what the line recorded (file types, stems, exclusivity)', () => {
    const r = resolveContractTiers([{ ...line, file_types: ['WAV'], stems_included: true, is_exclusive: true }], null);
    expect(r[0].terms).toMatchObject({ file_types: ['WAV'], stems_included: true, is_exclusive: true });
  });
  it('an invalid stored snapshot is ignored, not trusted', () => {
    const r = resolveContractTiers([{ ...line, terms: { ...mk(), streaming_limit: -3 } as TierTerms }], new Map([[UID, row]]));
    expect(r[0].source).toBe('licenses-row');
  });
});

describe('determinism and preview parity', () => {
  it('same inputs give the same text and snapshot', () => {
    const a = buildLicenseContract({ template: 'x {{tier_name}}', vars, tiers: [rt(mk())] });
    const b = buildLicenseContract({ template: 'x {{tier_name}}', vars, tiers: [rt(mk())] });
    expect(a).toEqual(b);
  });
  it('the editor preview is the same build as the webhook', () => {
    const tiers = [mk()];
    const built = buildLicenseContract({ template: '# T\n{{tier_name}}', vars: { ...SAMPLE_VARIABLES, license_type: 'Lease' }, tiers: tiers.map((t) => rt(t, 'preview')) });
    expect(previewTemplate('# T\n{{tier_name}}', tiers)).toBe(built.text);
  });
  it('records the template and tier sources', () => {
    const b = buildLicenseContract({ template: 'abc', vars, tiers: [rt(mk(), 'snapshot')] });
    expect(b.snapshot).toMatchObject({ v: 1, template_source: 'producer', template_used: 'abc' });
    expect(b.snapshot.tiers[0].source).toBe('snapshot');
  });
});
