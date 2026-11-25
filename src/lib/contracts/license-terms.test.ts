import { describe, it, expect } from 'vitest';
import {
  applyClauses, legacyTierTerms, lintTemplate, termsFlags, termsVariables, tierTermsFromRow, wrapInClause,
  CLAUSE_FLAG_LIST, MAX_CLAUSE_DEPTH, TERM_VARIABLE_LIST, type ClauseFlag,
} from './license-terms';
import {
  ALL_VARIABLE_KEYS, DEFAULT_TEMPLATE_MD, TIER_AWARE_TEMPLATE_MD, fillTemplate, VARIABLE_LIST,
  SAMPLE_VARIABLES,
} from './license-template';
import { previewTemplate } from './license-contract';

const OFF: Record<ClauseFlag, boolean> = {
  credit_required: false, stems_included: false, commercial_rights: false,
  sync_rights: false, broadcast_rights: false, is_exclusive: false,
};
const ON = (f: ClauseFlag): Record<ClauseFlag, boolean> => ({ ...OFF, [f]: true });

const row = {
  name: 'Premium', file_types: ['mp3', 'WAV', 'mp3'], stems_included: true, is_exclusive: false,
  streaming_limit: 100000, distribution_limit: null, commercial_rights: true, sync_rights: false,
  broadcast_rights: false, credit_required: true,
};

describe('existing templates render exactly as before', () => {
  const vars = SAMPLE_VARIABLES;
  it('the default template is byte-identical with and without clause flags', () => {
    expect(fillTemplate(DEFAULT_TEMPLATE_MD, vars, termsFlags([legacyTierTerms('lease')])))
      .toBe(fillTemplate(DEFAULT_TEMPLATE_MD, vars));
  });
  it('a template with no tier syntax is untouched by applyClauses, whatever the flags', () => {
    const t = 'a\n\n{{buyer_name}}\r\n- x\n---\n';
    expect(applyClauses(t, OFF)).toBe(t);
    expect(applyClauses(t, ON('credit_required'))).toBe(t);
  });
  it('passing no flags leaves directive lines as literal text (old behaviour)', () => {
    const t = '{{#if credit_required}}\nkeep\n{{/if}}';
    expect(fillTemplate(t, vars)).toBe(t);
  });
  it('DEFAULT_TEMPLATE_MD does not use any tier syntax', () => {
    expect(DEFAULT_TEMPLATE_MD).not.toMatch(/\{\{[#/]/);
    for (const k of TERM_VARIABLE_LIST) expect(DEFAULT_TEMPLATE_MD).not.toContain(`{{${k.key}}}`);
  });
});

describe('tierTermsFromRow', () => {
  it('normalises file types and reads limits', () => {
    const t = tierTermsFromRow(row);
    expect(t.file_types).toEqual(['MP3', 'WAV']);
    expect(t.streaming_limit).toBe(100000);
    expect(t.distribution_limit).toBeNull();
  });
  it('missing columns fall back to legacy terms and never invent "Not permitted"', () => {
    const t = tierTermsFromRow({ name: 'Old', is_exclusive: false, file_types: ['MP3'], stems_included: false });
    expect(t.streaming_limit).toBe(legacyTierTerms('lease').streaming_limit);
    expect(t.sync_rights).toBeNull();
    expect(termsVariables([t]).sync_use).toBe('Not specified');
  });
});

describe('termsVariables', () => {
  it('states one tier plainly', () => {
    const v = termsVariables([tierTermsFromRow(row)], 'Uche');
    expect(v).toMatchObject({
      tier_name: 'Premium', file_types: 'MP3, WAV', stems: 'Included', streaming_limit: '100,000 streams',
      distribution_limit: 'Unlimited', commercial_use: 'Permitted', sync_use: 'Not permitted',
      credit_requirement: 'Credit required: prod. Uche',
    });
  });
  it('states a shared value once and spells out a differing one per tier', () => {
    const a = tierTermsFromRow({ ...row, name: 'Basic', streaming_limit: 5000 });
    const b = tierTermsFromRow({ ...row, name: 'Pro' });
    const v = termsVariables([a, b, a]);
    expect(v.streaming_limit).toBe('Basic: 5,000 streams; Pro: 100,000 streams');
    expect(v.file_types).toBe('MP3, WAV');
    expect(v.tier_name).toBe('Basic + Pro');
  });
  it('an empty tier list reads as the legacy lease rather than throwing', () => {
    expect(termsVariables([]).tier_name).toBe('Lease');
  });
});

describe('termsFlags', () => {
  it('is on when any purchased tier has the flag; unknown counts as off', () => {
    const lease = legacyTierTerms('lease');
    const excl = legacyTierTerms('exclusive');
    expect(termsFlags([lease]).is_exclusive).toBe(false);
    expect(termsFlags([lease, excl]).is_exclusive).toBe(true);
    expect(termsFlags([lease]).sync_rights).toBe(false);
  });
});

describe('applyClauses', () => {
  const t = 'before\n{{#if credit_required}}\ncredit line\n{{/if}}\nafter';
  it('keeps the body when the flag is on and drops it when off', () => {
    expect(applyClauses(t, ON('credit_required'))).toBe('before\ncredit line\nafter');
    expect(applyClauses(t, OFF)).toBe('before\nafter');
  });
  it('#unless is the inverse and closes with {{/if}}', () => {
    const u = 'a\n{{#unless is_exclusive}}\nretained\n{{/if}}\nb';
    expect(applyClauses(u, OFF)).toBe('a\nretained\nb');
    expect(applyClauses(u, ON('is_exclusive'))).toBe('a\nb');
  });
  it('directive lines tolerate surrounding whitespace and CRLF', () => {
    expect(applyClauses('x\r\n  {{#if credit_required}}  \r\nkeep\r\n{{/if}}\r\ny', ON('credit_required'))).toBe('x\r\nkeep\r\ny');
  });
  it('a directive in the middle of a sentence is plain text', () => {
    const s = 'say {{#if credit_required}} then {{/if}} ok';
    expect(applyClauses(s, OFF)).toBe(s);
  });
  it('an unknown flag stays literal and its body is kept', () => {
    const s = '{{#if nope}}\nbody\n{{/if}}';
    expect(applyClauses(s, OFF)).toBe(s);
  });
  it('an unclosed block stays literal and hides nothing', () => {
    const s = 'a\n{{#if credit_required}}\nbody';
    expect(applyClauses(s, OFF)).toBe(s);
  });
  it('a stray close stays literal', () => {
    expect(applyClauses('a\n{{/if}}\nb', OFF)).toBe('a\n{{/if}}\nb');
  });
  it('nesting is supported: inner shows only when both are on', () => {
    const n = '{{#if credit_required}}\nA\n{{#if stems_included}}\nB\n{{/if}}\nC\n{{/if}}';
    expect(applyClauses(n, { ...OFF, credit_required: true, stems_included: true })).toBe('A\nB\nC');
    expect(applyClauses(n, ON('credit_required'))).toBe('A\nC');
    expect(applyClauses(n, ON('stems_included'))).toBe('');
  });
  it(`nesting deeper than ${MAX_CLAUSE_DEPTH} is left literal, with its own close`, () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_CLAUSE_DEPTH + 1; i += 1) lines.push('{{#if credit_required}}');
    lines.push('deep');
    for (let i = 0; i < MAX_CLAUSE_DEPTH + 1; i += 1) lines.push('{{/if}}');
    const out = applyClauses(lines.join('\n'), ON('credit_required')).split('\n');
    expect(out).toContain('deep');
    // the three valid levels vanish, the over-deep open and its close remain
    expect(out.filter((l) => l === '{{#if credit_required}}')).toHaveLength(1);
    expect(out.filter((l) => l === '{{/if}}')).toHaveLength(1);
  });
  it('is linear on a pathological template', () => {
    const big = '{{#if credit_required}}\n'.repeat(5000) + 'x\n' + '{{/if}}\n'.repeat(5000);
    const t0 = Date.now();
    applyClauses(big, OFF);
    lintTemplate(big, ALL_VARIABLE_KEYS);
    expect(Date.now() - t0).toBeLessThan(1000);
    const braces = '{{'.repeat(50000);
    const t1 = Date.now();
    fillTemplate(braces, SAMPLE_VARIABLES, OFF);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});

describe('lintTemplate', () => {
  it('is quiet for both defaults', () => {
    expect(lintTemplate(DEFAULT_TEMPLATE_MD, ALL_VARIABLE_KEYS)).toEqual([]);
    expect(lintTemplate(TIER_AWARE_TEMPLATE_MD, ALL_VARIABLE_KEYS)).toEqual([]);
  });
  it('names unknown placeholders, unknown options and unclosed blocks', () => {
    const p = lintTemplate('{{buyer_nme}}\n{{#if nope}}\nx\n{{/if}}\n{{#if credit_required}}\ny', ALL_VARIABLE_KEYS);
    expect(p).toEqual(expect.arrayContaining([
      'Unknown placeholder {{buyer_nme}}', 'Unknown clause option "nope"',
    ]));
    expect(p.some((s) => s.startsWith('Clause never closed'))).toBe(true);
  });
});

describe('wrapInClause', () => {
  it('wraps the touched lines', () => {
    const text = 'one\ntwo\nthree';
    const r = wrapInClause(text, 5, 6, 'credit_required');
    expect(r.text).toBe('one\n{{#if credit_required}}\ntwo\n{{/if}}\nthree');
    expect(applyClauses(r.text, OFF)).toBe('one\nthree');
  });
  it('inserts a starter clause at an empty selection', () => {
    const r = wrapInClause('a\nb', 2, 2, 'stems_included');
    expect(r.text).toContain('{{#if stems_included}}\n- Stems are delivered');
    expect(applyClauses(r.text, ON('stems_included'))).toContain('Stems are delivered');
    expect(applyClauses(r.text, OFF)).toBe('a\nb');
  });
  it('every flag has a starter and a label', () => {
    for (const f of CLAUSE_FLAG_LIST) { expect(f.starter).toBeTruthy(); expect(f.label).toBeTruthy(); }
  });
});

describe('tier-aware default + preview', () => {
  it('fills every placeholder for lease and exclusive, with no leftovers', () => {
    for (const type of ['lease', 'exclusive'] as const) {
      const out = previewTemplate(TIER_AWARE_TEMPLATE_MD, [legacyTierTerms(type)]);
      expect(out).not.toMatch(/\{\{/);
    }
  });
  it('shows the right clause per tier', () => {
    const lease = previewTemplate(TIER_AWARE_TEMPLATE_MD, [legacyTierTerms('lease')]);
    const excl = previewTemplate(TIER_AWARE_TEMPLATE_MD, [legacyTierTerms('exclusive')]);
    expect(lease).toContain('retains all underlying');
    expect(lease).toContain('prod. Uche2crazyyyy');
    expect(excl).toContain('will not re-sell');
    expect(excl).not.toContain('prod. Uche2crazyyyy');
  });
  it('an empty template previews as the tier-aware default, with the schedule', () => {
    const out = previewTemplate('  ', [legacyTierTerms('lease')]);
    expect(out).toContain('Audio streams: 5,000 streams');
    expect(out).toContain('## Schedule of Terms');
    expect(out).not.toContain('For Lease licenses:');
  });
  it('VARIABLE_LIST is unchanged', () => {
    expect(VARIABLE_LIST).toHaveLength(9);
  });
});
