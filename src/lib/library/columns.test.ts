import { describe, it, expect } from 'vitest';
import {
  LIBRARY_COLUMNS, DEFAULT_COLUMN_IDS, REQUIRED_COLUMN_IDS,
  resolveColumns, gridTemplate, reorderColumns, toggleColumn,
  fileTypeOf, licenseLabelOf, getColumn,
  type TrackWithTags,
} from './columns';

const track = (over: Partial<TrackWithTags> = {}): TrackWithTags => ({
  id: 't1', user_id: 'u1', title: 'Midnight Drive', type: 'beat',
  audio_url: 'r2://private/beats/midnight.wav', duration_seconds: 195,
  bpm: 140, key: 'F', scale: 'minor', stems_status: 'none',
  created_at: '2026-08-01T12:00:00.000Z',
  ...over,
} as TrackWithTags);

describe('column registry', () => {
  it('has unique ids', () => {
    const ids = LIBRARY_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defaults reference real columns', () => {
    for (const id of DEFAULT_COLUMN_IDS) expect(getColumn(id)).toBeDefined();
  });

  it('marks title required — a row without it cannot be identified', () => {
    expect(REQUIRED_COLUMN_IDS).toContain('title');
  });

  it('never throws on a track with everything missing', () => {
    const empty = track({
      bpm: null, key: null, scale: null, duration_seconds: null,
      energy: null, rating: null, status: null, track_tags: undefined,
      audio_url: '', created_at: '',
    });
    for (const col of LIBRARY_COLUMNS) {
      expect(() => col.value(empty)).not.toThrow();
      expect(typeof col.value(empty)).toBe('string');
    }
  });
});

describe('column values', () => {
  it('formats duration as m:ss with a padded seconds field', () => {
    const col = getColumn('duration')!;
    expect(col.value(track({ duration_seconds: 195 }))).toBe('3:15');
    expect(col.value(track({ duration_seconds: 65 }))).toBe('1:05');
    expect(col.value(track({ duration_seconds: null }))).toBe('');
    expect(col.value(track({ duration_seconds: -5 }))).toBe('');
  });

  it('suffixes minor keys and leaves major bare', () => {
    const col = getColumn('key')!;
    expect(col.value(track({ key: 'F', scale: 'minor' }))).toBe('Fm');
    expect(col.value(track({ key: 'F', scale: 'major' }))).toBe('F');
    expect(col.value(track({ key: null }))).toBe('');
  });

  it('shows analysis scores as percentages, not raw decimals', () => {
    const col = getColumn('energy')!;
    expect(col.value(track({ energy: 0.82 }))).toBe('82');
    expect(col.value(track({ energy: 0 }))).toBe('0');
    expect(col.value(track({ energy: null }))).toBe('');
  });

  it('splits genre and mood out of the tag list', () => {
    const t = track({ track_tags: [
      { tag: 'Trap', category: 'genre' }, { tag: 'Dark', category: 'mood' },
      { tag: '808s', category: 'instrument' },
    ] as TrackWithTags['track_tags'] });
    expect(getColumn('genre')!.value(t)).toBe('Trap');
    expect(getColumn('mood')!.value(t)).toBe('Dark');
    expect(getColumn('tags')!.value(t)).toBe('Trap, Dark, 808s');
  });

  it('renders an invalid date as empty rather than "Invalid Date"', () => {
    expect(getColumn('added')!.value(track({ created_at: 'nonsense' }))).toBe('');
  });
});

describe('fileTypeOf', () => {
  it('prefers the WAV master when there is one', () => {
    expect(fileTypeOf(track({ wav_url: 'r2://p/a.wav', audio_url: 'r2://p/a.mp3' }))).toBe('WAV');
  });

  it('falls back to the audio url and ignores a query string', () => {
    expect(fileTypeOf(track({ audio_url: 'https://cdn/x/beat.mp3?sig=abc' }))).toBe('MP3');
  });

  it('is empty when there is no extension to read', () => {
    expect(fileTypeOf(track({ audio_url: 'https://cdn/x/beat', wav_url: null }))).toBe('');
  });
});

describe('licenseLabelOf', () => {
  it('reports a sold exclusive above everything else', () => {
    expect(licenseLabelOf(track({ exclusive_sold: true, store_listed: true }))).toBe('Exclusive sold');
  });

  it('calls an unlisted track unlisted', () => {
    expect(licenseLabelOf(track({ store_listed: false, lease_price_usd: 30 }))).toBe('Unlisted');
  });

  it('shows the lease price when listed', () => {
    expect(licenseLabelOf(track({ store_listed: true, lease_price_usd: 30 }))).toBe('$30');
  });

  it('says Listed when priced only by the profile default', () => {
    expect(licenseLabelOf(track({ store_listed: true, lease_price_usd: null }))).toBe('Listed');
  });

  it('flags free downloads', () => {
    expect(licenseLabelOf(track({ store_listed: true, free_download_enabled: true }))).toBe('Free');
  });
});

describe('resolveColumns', () => {
  it('keeps the saved order', () => {
    expect(resolveColumns(['title', 'bpm', 'key']).map((c) => c.id)).toEqual(['title', 'bpm', 'key']);
  });

  it('drops ids from an older build instead of rendering a hole', () => {
    expect(resolveColumns(['title', 'gone', 'bpm']).map((c) => c.id)).toEqual(['title', 'bpm']);
  });

  it('collapses duplicates', () => {
    expect(resolveColumns(['title', 'bpm', 'bpm']).map((c) => c.id)).toEqual(['title', 'bpm']);
  });

  it('forces a hidden required column back in — a layout must stay readable', () => {
    const ids = resolveColumns(['bpm', 'key']).map((c) => c.id);
    expect(ids[0]).toBe('title');
  });

  it('falls back to defaults for junk, rather than a one-column table', () => {
    for (const junk of [null, 'nope', 42, [], ['garbage'], [null, undefined]]) {
      const ids = resolveColumns(junk).map((c) => c.id);
      expect(ids.length).toBeGreaterThan(1);
      expect(ids).toContain('title');
    }
  });
});

describe('gridTemplate', () => {
  it('brackets the data columns with the control and actions tracks', () => {
    const tpl = gridTemplate(resolveColumns(['title', 'bpm']));
    expect(tpl.startsWith('40px ')).toBe(true);
    expect(tpl.endsWith(' 32px')).toBe(true);
  });

  it('emits one track per column plus the two structural ones', () => {
    const cols = resolveColumns(['title', 'bpm', 'key', 'duration']);
    expect(gridTemplate(cols).split(' ').length).toBe(cols.length + 2);
  });
});

describe('reorderColumns', () => {
  const ids = ['title', 'bpm', 'key', 'duration'];

  it('moves an item forward and backward', () => {
    expect(reorderColumns(ids, 1, 3)).toEqual(['title', 'key', 'duration', 'bpm']);
    expect(reorderColumns(ids, 3, 0)).toEqual(['duration', 'title', 'bpm', 'key']);
  });

  it('is a no-op for the same index or an out-of-range one', () => {
    expect(reorderColumns(ids, 1, 1)).toEqual(ids);
    expect(reorderColumns(ids, -1, 2)).toEqual(ids);
    expect(reorderColumns(ids, 0, 99)).toEqual(ids);
  });

  it('does not mutate the input', () => {
    const original = [...ids];
    reorderColumns(ids, 0, 2);
    expect(ids).toEqual(original);
  });
});

describe('toggleColumn', () => {
  it('adds a hidden column and removes a shown one', () => {
    expect(toggleColumn(['title', 'bpm'], 'key')).toEqual(['title', 'bpm', 'key']);
    expect(toggleColumn(['title', 'bpm', 'key'], 'bpm')).toEqual(['title', 'key']);
  });

  it('refuses to hide a required column', () => {
    expect(toggleColumn(['title', 'bpm'], 'title')).toEqual(['title', 'bpm']);
  });

  it('ignores an unknown id', () => {
    expect(toggleColumn(['title'], 'nope')).toEqual(['title']);
  });
});
