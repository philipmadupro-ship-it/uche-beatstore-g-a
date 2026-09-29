import { describe, expect, it } from 'vitest';
import { downloadFilename } from './download-filename';

describe('downloadFilename', () => {
  it('prefers the RFC 5987 UTF-8 name the stream route sends', () => {
    expect(downloadFilename(`attachment; filename="Night_Shift.wav"; filename*=UTF-8''Night%20Shift%20%E2%80%94%20v2.wav`, 'x'))
      .toBe('Night Shift — v2.wav');
  });

  it('keeps the master extension (a WAV is not saved as .mp3)', () => {
    expect(downloadFilename('attachment; filename="Cold Front.wav"', 'Cold Front')).toBe('Cold Front.wav');
  });

  it('accepts an unquoted filename', () => {
    expect(downloadFilename('attachment; filename=beat.mp3', 'x')).toBe('beat.mp3');
  });

  it('falls back to the title when the header is missing', () => {
    expect(downloadFilename(null, 'Orbit')).toBe('Orbit.mp3');
    expect(downloadFilename(undefined, null)).toBe('track.mp3');
  });

  it('survives malformed percent-encoding', () => {
    expect(downloadFilename(`attachment; filename="ok.wav"; filename*=UTF-8''%E2%ZZ`, 'x')).toBe('ok.wav');
  });

  it('strips path characters from a title fallback', () => {
    expect(downloadFilename(null, 'a/b:c')).toBe('a_b_c.mp3');
  });
});
