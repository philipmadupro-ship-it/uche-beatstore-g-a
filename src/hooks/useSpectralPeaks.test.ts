import { describe, it, expect } from 'vitest';
import { analysisKey, parseBandsSidecar } from './useSpectralPeaks';

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

/**
 * The sidecar is fetched from a CDN, so it can be truncated, from an older
 * schema, or simply not the JSON we expect. A half-parsed file must route the
 * caller to local analysis rather than render a waveform from garbage — same
 * reasoning as the localStorage validation in `persisted-uploads.ts`.
 */
describe('parseBandsSidecar', () => {
  const valid = {
    version: 2,
    slices: 3,
    low: [0.1, 0.2, 0.3],
    mid: [0.4, 0.5, 0.6],
    high: [0.7, 0.8, 0.9],
    db: [-20, -18, -22],
    hz: [110, null, 220],
  };

  it('accepts a well-formed sidecar', () => {
    const out = parseBandsSidecar(valid);
    expect(out).not.toBeNull();
    expect(out!.low).toEqual([0.1, 0.2, 0.3]);
    expect(out!.hz).toEqual([110, null, 220]);
  });

  it('rejects anything that is not an object', () => {
    for (const v of [null, undefined]) {
      expect(parseBandsSidecar(v as never)).toBeNull();
    }
  });

  it('rejects a sidecar missing a band', () => {
    const { high: _drop, ...missing } = valid;
    expect(parseBandsSidecar(missing as never)).toBeNull();
  });

  it('rejects mismatched array lengths', () => {
    // Every array shares one index space; the client looks all four up with a
    // single slice index, so a short array would read undefined mid-render.
    expect(parseBandsSidecar({ ...valid, mid: [0.1] })).toBeNull();
    expect(parseBandsSidecar({ ...valid, db: [-20] })).toBeNull();
  });

  it('rejects an empty sidecar', () => {
    expect(parseBandsSidecar({ ...valid, low: [], mid: [], high: [], db: [], hz: [] })).toBeNull();
  });

  it('coerces non-finite numbers rather than propagating NaN into the render', () => {
    const out = parseBandsSidecar({ ...valid, low: [NaN, 0.2, 0.3] as number[] });
    expect(out!.low[0]).toBe(0);
  });

  it('falls back to a null pitch series when hz is absent or mismatched', () => {
    const noHz = parseBandsSidecar({ ...valid, hz: undefined });
    expect(noHz!.hz).toEqual([null, null, null]);
    const shortHz = parseBandsSidecar({ ...valid, hz: [110] });
    expect(shortHz!.hz).toEqual([null, null, null]);
  });
});
