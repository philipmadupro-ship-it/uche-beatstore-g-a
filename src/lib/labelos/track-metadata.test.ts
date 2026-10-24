import { describe, expect, it } from 'vitest';
import { canSeePrivateFields, withoutPrivate, capabilityFor, fieldsFor, isRealDate, planMetadataPatch, type MetadataValues } from './track-metadata';

const EMPTY: MetadataValues = {
  title: 'Midnight', version_label: null, isrc: null, iswc: null, bpm: null, key: null, language: null,
  explicit: null, genre: null, recorded_on: null, p_line: null, master_owner: null, notes: null,
};
const WRITER = new Set(['catalog.write']);
const RELEASE = new Set(['catalog.write', 'release.write']);

describe('planMetadataPatch', () => {
  it('an empty body changes nothing', () => {
    expect(planMetadataPatch({}, EMPTY, WRITER)).toEqual({ ok: true, set: {}, changed: [] });
  });

  it('writes only what differs and names those fields', () => {
    const r = planMetadataPatch({ title: 'Midnight', genre: ' Afrobeats ', explicit: false }, EMPTY, WRITER);
    expect(r).toEqual({ ok: true, set: { genre: 'Afrobeats', explicit: false }, changed: ['explicit', 'genre'] });
  });

  it('the ISRC needs release.write, every other field catalog.write', () => {
    expect(capabilityFor('isrc')).toBe('release.write');
    expect(capabilityFor('p_line')).toBe('catalog.write');
    expect(planMetadataPatch({ isrc: 'GB-AAA-26-00001' }, EMPTY, WRITER)).toMatchObject({ ok: false, status: 403, field: 'isrc' });
    expect(planMetadataPatch({ genre: 'x' }, EMPTY, new Set(['release.write']))).toMatchObject({ ok: false, status: 403 });
    expect(planMetadataPatch({ isrc: 'GB-AAA-26-00001', genre: 'Pop' }, EMPTY, RELEASE)).toMatchObject({ ok: true });
  });

  it('a 403 is decided before any value is looked at', () => {
    expect(planMetadataPatch({ isrc: 'not a code' }, EMPTY, WRITER)).toMatchObject({ ok: false, status: 403 });
  });

  it('normalises the codes through the shared validators', () => {
    const r = planMetadataPatch({ isrc: 'gb-aaa-26-00001', iswc: 't0345246801' }, EMPTY, RELEASE);
    expect(r).toMatchObject({ ok: true, set: { isrc: 'GBAAA2600001', iswc: 'T-034.524.680-1' } });
  });

  it('refuses a bad or non-ASCII code naming the field', () => {
    expect(planMetadataPatch({ isrc: 'GBAAA26００００１' }, EMPTY, RELEASE)).toMatchObject({ ok: false, status: 400, field: 'isrc' });
    expect(planMetadataPatch({ iswc: 'T-034.524.680-9' }, EMPTY, RELEASE)).toMatchObject({ ok: false, status: 400, field: 'iswc' });
  });

  it('blank or null clears an optional field, but not the title', () => {
    const cur = { ...EMPTY, genre: 'Pop', isrc: 'GBAAA2600001' };
    expect(planMetadataPatch({ genre: '  ', isrc: null }, cur, RELEASE)).toMatchObject({ ok: true, set: { genre: null, isrc: null } });
    expect(planMetadataPatch({ title: ' ' }, cur, WRITER)).toMatchObject({ ok: false, status: 400, field: 'title' });
  });

  it('bpm is a whole number in range', () => {
    expect(planMetadataPatch({ bpm: 140 }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { bpm: 140 } });
    for (const v of [10, 500, 120.5]) expect(planMetadataPatch({ bpm: v }, EMPTY, WRITER)).toMatchObject({ ok: false, field: 'bpm' });
  });

  it('a text bpm is judged by the planner, naming the field; notes keep their spacing', () => {
    expect(planMetadataPatch({ bpm: '14o' }, EMPTY, WRITER)).toMatchObject({ ok: false, status: 400, field: 'bpm' });
    expect(planMetadataPatch({ bpm: '140' }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { bpm: 140 } });
    expect(planMetadataPatch({ notes: '  indented\n' }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { notes: '  indented\n' } });
    expect(planMetadataPatch({ notes: ' \n ' }, { ...EMPTY, notes: 'x' }, WRITER)).toMatchObject({ ok: true, set: { notes: null } });
  });

  it('language is tidied and checked', () => {
    expect(planMetadataPatch({ language: 'PT-br' }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { language: 'pt-BR' } });
    expect(planMetadataPatch({ language: 'English' }, EMPTY, WRITER)).toMatchObject({ ok: false, field: 'language' });
  });

  it('recorded_on must be a real calendar date', () => {
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(planMetadataPatch({ recorded_on: '2026-13-01' }, EMPTY, WRITER)).toMatchObject({ ok: false, field: 'recorded_on' });
  });

  it('one-line fields refuse line breaks; notes may have them; lengths are capped', () => {
    expect(planMetadataPatch({ p_line: 'a\nb' }, EMPTY, WRITER)).toMatchObject({ ok: false, field: 'p_line' });
    expect(planMetadataPatch({ notes: 'a\nb' }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { notes: 'a\nb' } });
    expect(planMetadataPatch({ version_label: 'x'.repeat(81) }, EMPTY, WRITER)).toMatchObject({ ok: false, field: 'version_label' });
  });

  it('keeps the ℗ sign in a P-line', () => {
    expect(planMetadataPatch({ p_line: '℗ 2026 Label' }, EMPTY, WRITER)).toMatchObject({ ok: true, set: { p_line: '℗ 2026 Label' } });
  });
});

describe('fieldsFor', () => {
  it('a recording has no ISWC; a song shows everything (it may be its own master)', () => {
    expect(fieldsFor('recording')).not.toContain('iswc');
    expect(fieldsFor('recording')).toContain('isrc');
    expect(fieldsFor('song')).toContain('iswc');
    expect(fieldsFor('song')).toContain('isrc');
  });
});

describe('private fields', () => {
  it('only an editor or an internal reader sees them, never a roster artist', () => {
    expect(canSeePrivateFields(new Set(['catalog.write']), 'member')).toBe(true);
    expect(canSeePrivateFields(new Set(['catalog.read', 'business.read.internal']), 'member')).toBe(true);
    expect(canSeePrivateFields(new Set(['catalog.read']), 'member')).toBe(false);
    expect(canSeePrivateFields(new Set(['catalog.read', 'audio.finished']), 'member')).toBe(false);
    expect(canSeePrivateFields(new Set(['catalog.write', 'business.read.internal']), 'artist')).toBe(false);
  });
  it('omits the keys instead of nulling them', () => {
    const out = withoutPrivate(EMPTY, false);
    expect('notes' in out).toBe(false);
    expect('master_owner' in out).toBe(false);
    expect(out.title).toBe('Midnight');
    expect(withoutPrivate(EMPTY, true)).toEqual(EMPTY);
  });
  it('without private rights, naming a private field is a 403', () => {
    expect(planMetadataPatch({ notes: 'x' }, EMPTY, WRITER, false)).toMatchObject({ ok: false, status: 403, field: 'notes' });
    expect(planMetadataPatch({ genre: 'x' }, EMPTY, WRITER, false)).toMatchObject({ ok: true });
  });
});
