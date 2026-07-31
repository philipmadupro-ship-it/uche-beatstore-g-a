import { describe, it, expect } from 'vitest';
import { analysisKey } from './useSpectralPeaks';

/**
 * The analysis cache is a module-level Map that lives for the whole session.
 * It used to be keyed on track id ALONE, which meant replacing a track's audio
 * in place (re-upload, new version — same row, same id) served the previous
 * file's bands, dB and pitch against the new audio for the rest of the session:
 * a waveform that visibly disagrees with what you hear, with no way to
 * invalidate short of a full reload.
 */
describe('analysisKey', () => {
  it('distinguishes the same track with different audio', () => {
    // The actual bug: same id, new file, must not be a cache hit.
    expect(analysisKey('track-1', 'https://cdn/a.mp3'))
      .not.toBe(analysisKey('track-1', 'https://cdn/b.mp3'));
  });

  it('distinguishes different tracks sharing an audio URL', () => {
    expect(analysisKey('track-1', 'https://cdn/a.mp3'))
      .not.toBe(analysisKey('track-2', 'https://cdn/a.mp3'));
  });

  it('is stable for the same track and audio', () => {
    expect(analysisKey('track-1', 'https://cdn/a.mp3'))
      .toBe(analysisKey('track-1', 'https://cdn/a.mp3'));
  });

  it('cannot be collided by ids or URLs straddling the separator', () => {
    // A printable separator (a space, say) lets `id="a b", url="c"` collide
    // with `id="a", url="b c"`. NUL appears in neither an id nor a URL.
    expect(analysisKey('a b', 'c')).not.toBe(analysisKey('a', 'b c'));
    expect(analysisKey('a', 'b/c')).not.toBe(analysisKey('a/b', 'c'));
  });

  it('contains no printable separator that could appear in a URL', () => {
    const key = analysisKey('track-1', 'https://cdn/a.mp3');
    expect(key).toContain('\u0000');
  });
});
