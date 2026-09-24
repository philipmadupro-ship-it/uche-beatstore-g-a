import { describe, expect, it } from 'vitest';
import { matchesRating } from './rating-filter';

describe('matchesRating', () => {
  it('passes everything with no rating filter', () => {
    expect(matchesRating(null, null)).toBe(true);
  });
  it('atLeast keeps the tier and above, never unrated', () => {
    expect(matchesRating(4, 4)).toBe(true);
    expect(matchesRating(5, 4)).toBe(true);
    expect(matchesRating(3, 4)).toBe(false);
    expect(matchesRating(null, 1)).toBe(false);
  });
  it('exact keeps only that tier; 0 means unrated', () => {
    expect(matchesRating(4, 4, 'exact')).toBe(true);
    expect(matchesRating(5, 4, 'exact')).toBe(false);
    expect(matchesRating(null, 0, 'exact')).toBe(true);
    expect(matchesRating(0, 0, 'exact')).toBe(true);
    expect(matchesRating(2, 0, 'exact')).toBe(false);
  });
});
