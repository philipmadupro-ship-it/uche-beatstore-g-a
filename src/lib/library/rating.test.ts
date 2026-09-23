import { describe, expect, it } from 'vitest';
import {
  bulkRatingMessage, matchesRating, parseRatingMode, parseRatingValue, ratingFilterLabel,
} from './rating';

describe('matchesRating', () => {
  it('passes everything when the filter is off', () => {
    expect(matchesRating(null, null, 'atLeast')).toBe(true);
    expect(matchesRating(3, null, 'exactly')).toBe(true);
  });

  it('"at least" keeps the rating and everything above it', () => {
    expect(matchesRating(4, 4, 'atLeast')).toBe(true);
    expect(matchesRating(5, 4, 'atLeast')).toBe(true);
    expect(matchesRating(3, 4, 'atLeast')).toBe(false);
    expect(matchesRating(null, 4, 'atLeast')).toBe(false);
  });

  it('"exactly" keeps only that rating — the case the old filter could not express', () => {
    expect(matchesRating(4, 4, 'exactly')).toBe(true);
    expect(matchesRating(5, 4, 'exactly')).toBe(false);
    expect(matchesRating(3, 4, 'exactly')).toBe(false);
  });

  it('0 means unrated, in either mode', () => {
    expect(matchesRating(null, 0, 'atLeast')).toBe(true);
    expect(matchesRating(undefined, 0, 'exactly')).toBe(true);
    expect(matchesRating(0, 0, 'atLeast')).toBe(true);
    // Not "at least zero", which would be everything.
    expect(matchesRating(1, 0, 'atLeast')).toBe(false);
  });
});

describe('ratingFilterLabel', () => {
  it('reads the way the filter behaves', () => {
    expect(ratingFilterLabel(null, 'atLeast')).toBe('');
    expect(ratingFilterLabel(0, 'atLeast')).toBe('Unrated');
    expect(ratingFilterLabel(3, 'atLeast')).toBe('★ 3+');
    expect(ratingFilterLabel(3, 'exactly')).toBe('★ 3');
    // "5+" would promise a sixth star.
    expect(ratingFilterLabel(5, 'atLeast')).toBe('★ 5');
  });
});

describe('parsing stored filters', () => {
  it('defaults an unknown mode to "at least", which is what older saved views meant', () => {
    expect(parseRatingMode(undefined)).toBe('atLeast');
    expect(parseRatingMode('bogus')).toBe('atLeast');
    expect(parseRatingMode('exactly')).toBe('exactly');
  });

  it('accepts 0–5 integers and nothing else', () => {
    expect(parseRatingValue(0)).toBe(0);
    expect(parseRatingValue(5)).toBe(5);
    expect(parseRatingValue(6)).toBeNull();
    expect(parseRatingValue(-1)).toBeNull();
    expect(parseRatingValue(2.5)).toBeNull();
    expect(parseRatingValue('4')).toBeNull();
  });
});

describe('bulkRatingMessage', () => {
  it('reports full success, partial failure and total failure differently', () => {
    expect(bulkRatingMessage(4, 12, 0)).toEqual({ tone: 'success', text: 'Rated 4★: 12 tracks' });
    expect(bulkRatingMessage(4, 12, 2)).toEqual({ tone: 'warning', text: 'Rated 4★: 10 tracks — 2 failed' });
    expect(bulkRatingMessage(4, 3, 3)).toEqual({ tone: 'error', text: "Couldn't rate 3 tracks" });
  });

  it('describes clearing as clearing', () => {
    expect(bulkRatingMessage(0, 1, 0).text).toBe('Cleared rating on 1 track');
  });
});
