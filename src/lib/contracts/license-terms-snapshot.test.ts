import { describe, it, expect } from 'vitest';
import { LICENSE_FILE_TYPES, parseTierTerms } from './license-terms-snapshot';

const good = {
  name: 'Premium', file_types: ['mp3', ' wav ', 'MP3'], stems_included: true, is_exclusive: false,
  streaming_limit: 100000, distribution_limit: null, commercial_rights: true, sync_rights: null,
  broadcast_rights: false, credit_required: true,
};

describe('parseTierTerms', () => {
  it('accepts a valid tier and normalises file-type formatting only', () => {
    const r = parseTierTerms(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.terms.file_types).toEqual(['MP3', 'WAV']);
      expect(r.terms.sync_rights).toBeNull();
      expect(r.terms.distribution_limit).toBeNull();
    }
  });
  it('allows every file type the License Builder offers, plus AIFF', () => {
    for (const t of ['MP3', 'WAV', 'FLAC', 'STEMS', 'MIDI', 'PROJECT', 'AIFF']) {
      expect(LICENSE_FILE_TYPES).toContain(t);
      expect(parseTierTerms({ ...good, file_types: [t] }).ok).toBe(true);
    }
  });
  const bad: Array<[string, Record<string, unknown>]> = [
    ['NaN stream limit', { streaming_limit: NaN }],
    ['negative stream limit', { streaming_limit: -5 }],
    ['zero distribution limit', { distribution_limit: 0 }],
    ['fractional limit', { streaming_limit: 10.5 }],
    ['string limit', { streaming_limit: '5000' }],
    ['Infinity limit', { distribution_limit: Infinity }],
    ['unknown file type', { file_types: ['MP3', 'OGG'] }],
    ['non-string file type', { file_types: ['MP3', 7] }],
    ['file_types not an array', { file_types: 'MP3' }],
    ['string rights', { commercial_rights: 'yes' }],
    ['undefined rights', { sync_rights: undefined }],
    ['non-boolean stems', { stems_included: 1 }],
    ['empty name', { name: '   ' }],
    ['extra key', { surprise: true }],
  ];
  it.each(bad)('rejects %s, never reading it as unlimited', (_n, patch) => {
    const r = parseTierTerms({ ...good, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 'x', 3, []]) expect(parseTierTerms(v).ok).toBe(false);
  });
  it('accepts an empty file list (a tier can deliver none) and null limits', () => {
    expect(parseTierTerms({ ...good, file_types: [], streaming_limit: null }).ok).toBe(true);
  });
});
