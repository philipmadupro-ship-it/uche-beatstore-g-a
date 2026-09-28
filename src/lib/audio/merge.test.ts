import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { mergeFeatures } from './merge';
import { parseTitleMetadata } from '@/lib/upload/title-metadata';

/**
 * The parser's top-level bpm/key are what every upload path hands to
 * mergeFeatures as its highest-precedence source. An uncertain field must
 * arrive as null there, or it outranks the detector anyway.
 */
describe('mergeFeatures × filename certainty', () => {
  const client = { bpm: 96, key: 'D', scale: 'minor' };

  it('a clear filename still wins over the detector', () => {
    const merged = mergeFeatures({ title: parseTitleMetadata('Night Shift 140 Fm.wav'), client });
    expect(merged).toMatchObject({ bpm: 140, key: 'F', scale: 'minor' });
  });

  it('an ambiguous filename does not outrank the detector', () => {
    const merged = mergeFeatures({ title: parseTitleMetadata('beat 90 140 Am Fm.wav'), client });
    expect(merged).toMatchObject({ bpm: 96, key: 'D', scale: 'minor' });
  });

  it('a word that looks like a key does not outrank the detector', () => {
    const merged = mergeFeatures({ title: parseTitleMetadata('BB gun.wav'), client });
    expect(merged).toMatchObject({ key: 'D', scale: 'minor' });
  });

  it('with no detector, an ambiguous field stays empty rather than guessed', () => {
    const merged = mergeFeatures({ title: parseTitleMetadata('beat 90 140 Am Fm.wav') });
    expect(merged).toMatchObject({ bpm: null, key: null, scale: null });
  });
});
