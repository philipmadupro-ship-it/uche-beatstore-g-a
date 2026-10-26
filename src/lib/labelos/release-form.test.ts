import { describe, expect, it } from 'vitest';
import { buildReleaseCreateBody, formatTerritories, parseTerritories, parseLanguage } from './release-form';

describe('parseTerritories', () => {
  it('reads codes separated by commas, spaces or semicolons, upper-cased and once each', () => {
    expect(parseTerritories('us, gb  fr;us')).toEqual({ ok: true, codes: ['US', 'GB', 'FR'] });
  });
  it('treats blank as not stated', () => {
    expect(parseTerritories('   ')).toEqual({ ok: true, codes: null });
  });
  it('accepts WW for worldwide', () => {
    expect(parseTerritories('ww')).toEqual({ ok: true, codes: ['WW'] });
  });
  it('names the first thing that is not a two-letter code', () => {
    expect(parseTerritories('US, USA')).toEqual({ ok: false, error: '“USA” is not a two-letter country code (use WW for worldwide).' });
    expect(parseTerritories('U5')).toMatchObject({ ok: false });
  });
  it('WW is worldwide on its own, never beside a country', () => {
    expect(parseTerritories('WW US')).toMatchObject({ ok: false });
    expect(parseTerritories('us ww')).toMatchObject({ ok: false });
  });
  it('refuses more than 250', () => {
    const many = Array.from({ length: 676 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))).slice(0, 251).join(',');
    expect(parseTerritories(many)).toMatchObject({ ok: false });
  });
});

describe('formatTerritories', () => {
  it('joins with a comma and a space; none is empty', () => {
    expect(formatTerritories(['US', 'GB'])).toBe('US, GB');
    expect(formatTerritories(null)).toBe('');
  });
});

describe('parseLanguage', () => {
  it('lower-cases the language part and keeps a region', () => {
    expect(parseLanguage('EN')).toEqual({ ok: true, code: 'en' });
    expect(parseLanguage('pt-br')).toEqual({ ok: true, code: 'pt-BR' });
    expect(parseLanguage('')).toEqual({ ok: true, code: null });
  });
  it('keeps every subtag, with BCP 47 casing', () => {
    expect(parseLanguage('zh-hant-tw')).toEqual({ ok: true, code: 'zh-Hant-TW' });
    expect(parseLanguage('PT_br')).toEqual({ ok: true, code: 'pt-BR' });
  });
  it('refuses a word', () => {
    expect(parseLanguage('English')).toMatchObject({ ok: false });
  });
});

describe('buildReleaseCreateBody', () => {
  const base = { title: '  Night Shift ', contactId: 'c1', type: 'single', labelName: '', upc: '', cLine: '', pLine: '', genre: '', territories: '', language: '', distributor: '', targetDate: '' };
  it('trims, and leaves out what is empty', () => {
    expect(buildReleaseCreateBody(base)).toEqual({ ok: true, body: { title: 'Night Shift', contact_id: 'c1', type: 'single' } });
  });
  it('sends what was typed under the route’s field names', () => {
    const r = buildReleaseCreateBody({ ...base, labelName: 'Board Records', upc: '036000291452', cLine: '© 2026 B', pLine: '℗ 2026 B', genre: 'Alt', territories: 'us gb', language: 'en', distributor: 'DistroKid', targetDate: '2026-12-01' });
    expect(r).toEqual({
      ok: true,
      body: {
        title: 'Night Shift', contact_id: 'c1', type: 'single', label_name: 'Board Records', upc: '036000291452', c_line: '© 2026 B', p_line: '℗ 2026 B',
        primary_genre: 'Alt', territories: ['US', 'GB'], language: 'en', distributor: 'DistroKid', target_date: '2026-12-01',
      },
    });
  });
  it('reports a bad territory or language before anything is sent', () => {
    expect(buildReleaseCreateBody({ ...base, territories: 'USA' })).toMatchObject({ ok: false, field: 'territories' });
    expect(buildReleaseCreateBody({ ...base, language: 'English' })).toMatchObject({ ok: false, field: 'language' });
  });
  it('needs a title and an artist', () => {
    expect(buildReleaseCreateBody({ ...base, title: '  ' })).toMatchObject({ ok: false, field: 'title' });
    expect(buildReleaseCreateBody({ ...base, contactId: '' })).toMatchObject({ ok: false, field: 'contact_id' });
  });
});
