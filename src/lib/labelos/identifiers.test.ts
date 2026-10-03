import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDENTIFIER_PATTERNS,
  normalizeIpi,
  normalizeIsrc,
  normalizeIswc,
  normalizeUpc,
  parseIdentifier,
  upcCheckDigit,
  iswcCheckDigit,
} from './identifiers';

describe('ISRC', () => {
  it('accepts the compact and the hyphenated form and normalises to compact upper case', () => {
    expect(normalizeIsrc('USRC17607839')).toBe('USRC17607839');
    expect(normalizeIsrc('US-RC1-76-07839')).toBe('USRC17607839');
    expect(normalizeIsrc(' us-rc1-76-07839 ')).toBe('USRC17607839');
    expect(normalizeIsrc('GB A1B 24 00001')).toBe('GBA1B2400001');
  });

  it('refuses wrong lengths, a digit country code and letters in the designation', () => {
    for (const bad of ['', 'USRC1760783', 'USRC176078390', '12RC17607839', 'USRC1760783X', 'US_RC17607839', 'USRC17607839/']) {
      expect(normalizeIsrc(bad), bad).toBeNull();
    }
  });
});

describe('UPC / EAN', () => {
  it('computes the GS1 check digit', () => {
    expect(upcCheckDigit('03600029145')).toBe(2); // UPC-A 036000291452
    expect(upcCheckDigit('400638133393')).toBe(1); // EAN-13 4006381333931
  });

  it('accepts 12-digit UPC-A and 13-digit EAN-13 with a valid check digit, spaces and dashes stripped', () => {
    expect(normalizeUpc('036000291452')).toBe('036000291452');
    expect(normalizeUpc('0 36000 29145 2')).toBe('036000291452');
    expect(normalizeUpc('4006381333931')).toBe('4006381333931');
    expect(normalizeUpc('400-6381-33393-1')).toBe('4006381333931');
  });

  it('refuses a wrong check digit, a wrong length and letters', () => {
    for (const bad of ['036000291453', '4006381333932', '03600029145', '40063813339310', '03600029145A', '']) {
      expect(normalizeUpc(bad), bad).toBeNull();
    }
  });
});

describe('ISWC', () => {
  it('computes the check digit (T counts 1, digits weighted 1..9)', () => {
    expect(iswcCheckDigit('034524680')).toBe(1);
  });

  it('accepts every punctuation the 140 CHECK allows and normalises to T-DDD.DDD.DDD-C', () => {
    for (const raw of ['T-034.524.680-1', 'T0345246801', 't-034524680-1', 'T 034 524 680 1', 'T034.524.6801']) {
      expect(normalizeIswc(raw), raw).toBe('T-034.524.680-1');
    }
  });

  it('refuses a wrong check digit, a missing T and wrong lengths', () => {
    for (const bad of ['T-034.524.680-2', '0345246801', 'T-034.524.68-1', 'T-034.524.6800-1', '']) {
      expect(normalizeIswc(bad), bad).toBeNull();
    }
  });
});

describe('IPI', () => {
  it('accepts 9 to 11 digits, separators stripped', () => {
    expect(normalizeIpi('00052210040')).toBe('00052210040');
    expect(normalizeIpi('000 522 100 40')).toBe('00052210040');
    expect(normalizeIpi('123456789')).toBe('123456789');
  });

  it('refuses fewer than 9 or more than 11 digits and letters', () => {
    for (const bad of ['12345678', '123456789012', 'I-000000229-7', '']) {
      expect(normalizeIpi(bad), bad).toBeNull();
    }
  });
});

describe('parseIdentifier', () => {
  it('names the field in its error', () => {
    expect(parseIdentifier('upc', '036000291453')).toEqual({ ok: false, error: 'upc: not a valid UPC/EAN (12 or 13 digits with a valid check digit)' });
    expect(parseIdentifier('isrc', 'nope')).toEqual({ ok: false, error: 'isrc: not a valid ISRC (CC-XXX-YY-NNNNN)' });
    expect(parseIdentifier('iswc', 'T-034.524.680-2')).toEqual({ ok: false, error: 'iswc: not a valid ISWC (T-DDD.DDD.DDD-C with a valid check digit)' });
    expect(parseIdentifier('ipi', '1')).toEqual({ ok: false, error: 'ipi: not a valid IPI (9 to 11 digits)' });
  });

  it('returns the normalised value', () => {
    expect(parseIdentifier('isrc', 'us-rc1-76-07839')).toEqual({ ok: true, value: 'USRC17607839' });
  });
});

describe('the database CHECKs accept every normalised value (05 §7)', () => {
  const sql = (file: string) => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');
  const checkRegex = (file: string, constraint: string) => {
    const m = sql(file).match(new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\([a-z_]+ IS NULL OR [a-z_]+ ~ '([^']+)'\\)`));
    if (!m) throw new Error(`${constraint} not found in ${file}`);
    return new RegExp(m[1]);
  };

  it('tracks_isrc_format (141)', () => {
    expect(checkRegex('141_labelos_org_catalog.sql', 'tracks_isrc_format').test(normalizeIsrc('US-RC1-76-07839')!)).toBe(true);
  });

  it('tracks_iswc_format (140)', () => {
    expect(checkRegex('140_labelos_song_fields.sql', 'tracks_iswc_format').test(normalizeIswc('T0345246801')!)).toBe(true);
  });

  it('releases_upc_format (144) is the module pattern', () => {
    const re = checkRegex('144_labelos_releases.sql', 'releases_upc_format');
    expect(re.source).toBe(IDENTIFIER_PATTERNS.upc.source);
    expect(re.test(normalizeUpc('0 36000 29145 2')!)).toBe(true);
  });
});
