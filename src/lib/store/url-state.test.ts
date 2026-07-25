import { describe, expect, it } from 'vitest';
import { buildStoreFilterParams, parseStoreFilterParams } from './url-state';

describe('store URL filter state', () => {
  it('parses valid filter params and ignores invalid enums', () => {
    const parsed = parseStoreFilterParams(new URLSearchParams({
      q: 'dark keys',
      type: 'beats',
      genre: 'Trap',
      mood: 'Dark',
      key: 'F#',
      scale: 'major',
      duration: 'medium',
      free: '1',
      favorites: '1',
      new: '1',
      sort: 'price-asc',
      bpm_min: '90',
      bpm_max: '150',
      price_min: '25',
      price_max: '80',
    }));

    expect(parsed).toMatchObject({
      searchQuery: 'dark keys',
      typeFilter: 'beats',
      genreFilter: 'Trap',
      moodFilter: 'Dark',
      keyFilter: 'F#',
      scaleFilter: 'major',
      durationBucket: 'medium',
      freeOnly: true,
      favoritesOnly: true,
      newThisWeek: true,
      sortBy: 'price-asc',
      bpmMin: 90,
      bpmMax: 150,
      priceMin: 25,
      priceMax: 80,
    });

    const invalid = parseStoreFilterParams(new URLSearchParams({
      type: 'album',
      scale: 'dorian',
      duration: 'forever',
      sort: 'random',
      bpm_min: 'fast',
    }));
    expect(invalid.typeFilter).toBe('all');
    expect(invalid.scaleFilter).toBe('');
    expect(invalid.durationBucket).toBe('');
    expect(invalid.sortBy).toBe('newest');
    expect(invalid.bpmMin).toBeNull();
  });

  it('serializes active filters while preserving unrelated params', () => {
    const params = buildStoreFilterParams(new URLSearchParams('purchase=success&q=old'), {
      searchQuery: 'summer bounce',
      typeFilter: 'beats',
      genreFilter: 'Afrobeats',
      moodFilter: '',
      keyFilter: '',
      scaleFilter: 'minor',
      durationBucket: 'short',
      freeOnly: true,
      favoritesOnly: false,
      newThisWeek: true,
      sortBy: 'popular',
      bpmMin: 92,
      bpmMax: 116,
      bpmRangeActive: true,
      priceMin: 0,
      priceMax: 200,
      priceRangeActive: false,
    });

    expect(params.get('purchase')).toBe('success');
    expect(params.get('q')).toBe('summer bounce');
    expect(params.get('type')).toBe('beats');
    expect(params.get('genre')).toBe('Afrobeats');
    expect(params.get('scale')).toBe('minor');
    expect(params.get('duration')).toBe('short');
    expect(params.get('free')).toBe('1');
    expect(params.get('new')).toBe('1');
    expect(params.get('sort')).toBe('popular');
    expect(params.get('bpm_min')).toBe('92');
    expect(params.get('bpm_max')).toBe('116');
    expect(params.has('price_min')).toBe(false);
  });

  it('removes old filter params when filters are reset', () => {
    const params = buildStoreFilterParams(new URLSearchParams('q=old&type=beat&session_id=cs_test'), {
      searchQuery: '',
      typeFilter: 'all',
      genreFilter: '',
      moodFilter: '',
      keyFilter: '',
      scaleFilter: '',
      durationBucket: '',
      freeOnly: false,
      favoritesOnly: false,
      newThisWeek: false,
      sortBy: 'newest',
      bpmMin: 60,
      bpmMax: 180,
      bpmRangeActive: false,
      priceMin: 0,
      priceMax: 100,
      priceRangeActive: false,
    });

    expect(params.toString()).toBe('session_id=cs_test');
  });
});
