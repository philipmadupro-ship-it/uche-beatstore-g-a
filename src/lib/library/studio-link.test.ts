import { describe, expect, it } from 'vitest';
import { studioHref } from './studio-link';

describe('studioHref', () => {
  it('deep-links the studio with the track preselected', () => {
    expect(studioHref('abc-123')).toBe('/studio?track=abc-123');
  });

  it('encodes the id so it cannot add query params of its own', () => {
    expect(studioHref('a&b=c')).toBe('/studio?track=a%26b%3Dc');
  });
});
