import { describe, expect, it } from 'vitest';
import {
  analyzeLicenseTiers, tierDraftFromRow, templateHasCreditWording,
  CHEAP_LEASE_MAX_USD, CHEAP_SYNC_MAX_USD, type TierDraft,
} from './analysis';

let n = 0;
const tier = (o: Partial<TierDraft> = {}): TierDraft => ({
  id: `t${++n}`, name: `Tier ${n}`, price_usd: 80, is_free: false, file_types: ['MP3', 'WAV'],
  stems_included: false, is_exclusive: false, streaming_limit: 100_000, distribution_limit: null,
  commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: true, ...o,
});
const codes = (tiers: TierDraft[], template?: string | null) =>
  analyzeLicenseTiers({ tiers, template }).findings.map((f) => f.code);
const fires = (t: Partial<TierDraft>, code: string, template?: string) => codes([tier(t)], template).includes(code as never);

describe('per-tier rules: fire and do not fire', () => {
  const cases: Array<[string, Partial<TierDraft>, Partial<TierDraft>]> = [
    ['NO_FILES', { file_types: [] }, { file_types: ['MP3'] }],
    ['NAME_MISSING', { name: '  ' }, { name: 'Lease' }],
    ['FREE_EXCLUSIVE', { is_free: true, is_exclusive: true, price_usd: 0 }, { is_free: true, price_usd: 0 }],
    ['FREE_SYNC', { is_free: true, price_usd: 0, sync_rights: true }, { is_free: true, price_usd: 0, sync_rights: null }],
    ['FREE_UNLIMITED', { is_free: true, price_usd: 0, streaming_limit: null }, { is_free: true, price_usd: 0, streaming_limit: 5000 }],
    ['PRICE_ZERO_NOT_FREE', { price_usd: 0 }, { price_usd: 0, is_free: true }],
    ['FREE_PRICE_SET', { is_free: true, price_usd: 30 }, { is_free: true, price_usd: 0 }],
    ['EXCLUSIVE_NO_WAV', { is_exclusive: true, file_types: ['MP3'], price_usd: 400, streaming_limit: null }, { is_exclusive: true, file_types: ['MP3', 'WAV'], price_usd: 400, streaming_limit: null }],
    ['EXCLUSIVE_NO_STEMS', { is_exclusive: true, file_types: ['MP3', 'WAV'], price_usd: 400, streaming_limit: null }, { is_exclusive: true, file_types: ['MP3', 'WAV'], stems_included: true, price_usd: 400, streaming_limit: null }],
    ['EXCLUSIVE_LIMITED', { is_exclusive: true, price_usd: 400 }, { is_exclusive: true, price_usd: 400, streaming_limit: null, distribution_limit: null }],
    ['STEMS_FLAG_NO_FILE', { stems_included: true }, { stems_included: true, file_types: ['MP3', 'STEMS'] }],
    ['STEMS_FILE_NO_FLAG', { file_types: ['MP3', 'STEMS'] }, { file_types: ['MP3', 'STEMS'], stems_included: true }],
    ['CHEAP_UNLIMITED', { price_usd: 29, streaming_limit: null }, { price_usd: 29, streaming_limit: 50_000 }],
    ['CHEAP_SYNC', { price_usd: 60, sync_rights: true }, { price_usd: 60, sync_rights: false }],
    ['NO_COMMERCIAL_BUT_PAID_RIGHTS', { commercial_rights: false, sync_rights: true, price_usd: 500 }, { commercial_rights: null, sync_rights: true, price_usd: 500 }],
    ['LIMIT_MISMATCH', { streaming_limit: 10_000, distribution_limit: 50_000 }, { streaming_limit: 50_000, distribution_limit: 50_000 }],
  ];
  for (const [code, yes, no] of cases) {
    it(`${code} fires`, () => expect(fires(yes, code)).toBe(true));
    it(`${code} stays quiet`, () => expect(fires(no, code)).toBe(false));
  }
});

describe('null rights mean "not specified", never false', () => {
  it('a legacy tier with every right null raises no rights finding', () => {
    const t = tier({ commercial_rights: null, sync_rights: null, broadcast_rights: null, price_usd: 20, is_free: false, streaming_limit: 5000 });
    expect(codes([t])).toEqual([]);
  });
  it('tierDraftFromRow keeps missing rights columns null', () => {
    const d = tierDraftFromRow({ id: 'x', name: 'Old', price_usd: 30 });
    expect([d.commercial_rights, d.sync_rights, d.broadcast_rights]).toEqual([null, null, null]);
  });
});

describe('price thresholds', () => {
  it('cheap-unlimited boundary', () => {
    expect(fires({ price_usd: CHEAP_LEASE_MAX_USD - 0.01, streaming_limit: null }, 'CHEAP_UNLIMITED')).toBe(true);
    expect(fires({ price_usd: CHEAP_LEASE_MAX_USD, streaming_limit: null }, 'CHEAP_UNLIMITED')).toBe(false);
  });
  it('cheap-sync boundary', () => {
    expect(fires({ price_usd: CHEAP_SYNC_MAX_USD - 0.01, sync_rights: true }, 'CHEAP_SYNC')).toBe(true);
    expect(fires({ price_usd: CHEAP_SYNC_MAX_USD, sync_rights: true }, 'CHEAP_SYNC')).toBe(false);
  });
  it('an exclusive is not flagged as a cheap lease', () => {
    expect(fires({ is_exclusive: true, price_usd: 10, file_types: ['WAV'], streaming_limit: null }, 'CHEAP_UNLIMITED')).toBe(false);
  });
});

describe('across tiers', () => {
  it('flags a pricier tier that grants nothing extra', () => {
    const cheap = tier({ name: 'A', price_usd: 60, file_types: ['MP3', 'WAV'], streaming_limit: null });
    const dear = tier({ name: 'B', price_usd: 90, file_types: ['MP3'], streaming_limit: 50_000 });
    const a = analyzeLicenseTiers({ tiers: [cheap, dear] });
    expect(a.perTier[dear.id].map((f) => f.code)).toContain('TIER_NOT_ABOVE_CHEAPER');
    expect(a.perTier[cheap.id].map((f) => f.code)).not.toContain('TIER_NOT_ABOVE_CHEAPER');
  });
  it('a sensible ladder is quiet', () => {
    const mp3 = tier({ name: 'MP3', price_usd: 30, file_types: ['MP3'], streaming_limit: 50_000 });
    const wav = tier({ name: 'WAV', price_usd: 60, file_types: ['MP3', 'WAV'], streaming_limit: 100_000 });
    expect(codes([mp3, wav]).filter((c) => c.startsWith('TIER_'))).toEqual([]);
  });
  it('identical terms are one duplicate, not also an inversion', () => {
    const a = tier({ name: 'A' });
    const b = tier({ name: 'B', price_usd: 120 });
    expect(codes([a, b]).filter((c) => c.startsWith('TIER_'))).toEqual(['TIER_DUPLICATE_TERMS']);
  });
  it('flags duplicate names case-insensitively', () => {
    expect(codes([tier({ name: 'Lease', file_types: ['MP3'] }), tier({ name: ' lease ', price_usd: 200 })])).toContain('TIER_DUPLICATE_NAME');
  });
  it('does not compare an exclusive with a lease', () => {
    const lease = tier({ name: 'Lease', price_usd: 90, file_types: ['MP3', 'WAV', 'STEMS'], stems_included: true, streaming_limit: null });
    const excl = tier({ name: 'Excl', price_usd: 400, is_exclusive: true, file_types: ['MP3', 'WAV'], streaming_limit: null });
    expect(codes([lease, excl]).filter((c) => c.startsWith('TIER_'))).toEqual([]);
  });
});

describe('template-aware rules', () => {
  const t = () => tier({ credit_required: true });
  it('empty template = default = no credit-wording finding', () => {
    expect(codes([t()], '')).not.toContain('CREDIT_NO_WORDING');
    expect(codes([t()], '   \n')).not.toContain('CREDIT_NO_WORDING');
    expect(codes([t()], null)).not.toContain('CREDIT_NO_WORDING');
  });
  it('a custom template with no credit wording is noted', () => {
    expect(codes([t()], 'Plain contract {{streaming_limit}}')).toContain('CREDIT_NO_WORDING');
  });
  it('placeholder or clause counts as wording', () => {
    expect(codes([t()], 'x {{credit_requirement}}')).not.toContain('CREDIT_NO_WORDING');
    expect(codes([t()], '{{#if credit_required}}\n- credit\n{{/if}}')).not.toContain('CREDIT_NO_WORDING');
    expect(templateHasCreditWording('{{#if  credit_required }}')).toBe(true);
  });
  it('a template with no tier placeholders is noted once, not per tier', () => {
    const a = analyzeLicenseTiers({ tiers: [tier(), tier({ price_usd: 200, file_types: ['MP3'] })], template: 'Just prose.' });
    expect(a.general.filter((f) => f.code === 'TEMPLATE_MISSING_TERMS')).toHaveLength(1);
  });
  it('unused credit clause when no tier requires credit', () => {
    expect(codes([tier({ credit_required: false })], '{{#if credit_required}}\n- c\n{{/if}} {{streaming_limit}}')).toContain('CREDIT_CLAUSE_UNUSED');
    expect(codes([tier({ credit_required: true })], '{{#if credit_required}}\n- c\n{{/if}} {{streaming_limit}}')).not.toContain('CREDIT_CLAUSE_UNUSED');
  });
});

describe('result shape', () => {
  it('is deterministic and sorted risk → warn → info', () => {
    const tiers = [tier({ file_types: [], price_usd: 0 }), tier({ is_exclusive: true, file_types: ['MP3'], price_usd: 400 })];
    const a = analyzeLicenseTiers({ tiers });
    expect(analyzeLicenseTiers({ tiers })).toEqual(a);
    const order = a.findings.map((f) => ({ risk: 0, warn: 1, info: 2 })[f.severity]);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });
  it('summarises counts in words', () => {
    expect(analyzeLicenseTiers({ tiers: [] }).summary.text).toBe('Nothing to flag');
    const s = analyzeLicenseTiers({ tiers: [tier({ file_types: [] })] }).summary;
    expect(s.risk).toBe(1);
    expect(s.text).toContain('1 risk');
  });
  it('never claims legal certainty', () => {
    const all = analyzeLicenseTiers({ tiers: [tier({ file_types: [], is_free: true, is_exclusive: true, sync_rights: true, price_usd: 5 })] }).findings;
    for (const f of all) expect(`${f.message} ${f.suggestion}`).not.toMatch(/illegal|unlawful|invalid|void|will be refused/i);
  });
  it('survives hostile input', () => {
    const t = tier({ name: 'x'.repeat(5000), price_usd: Number.NaN });
    expect(() => analyzeLicenseTiers({ tiers: [t, tierDraftFromRow({})] })).not.toThrow();
    expect(tierDraftFromRow({ price_usd: 'abc' }).price_usd).toBe(0);
  });
  it('lists one comparison row per tier', () => {
    const a = analyzeLicenseTiers({ tiers: [tier({ name: 'A' }), tier({ name: 'B', price_usd: 200, file_types: ['MP3'] })] });
    expect(a.comparison.map((c) => c.name)).toEqual(['A', 'B']);
  });
});
