import { describe, it, expect } from 'vitest';
import { mp3Status } from './mp3-status';

describe('mp3Status', () => {
  it('is ready as-is when the master is an MP3, whatever storage says', () => {
    for (const exists of [true, false, null]) {
      expect(mp3Status('r2://b/k.mp3', exists)).toMatchObject({ state: 'master', label: 'MP3 ready', canMake: false });
    }
  });

  it('is ready only when a current derivative is known to exist', () => {
    expect(mp3Status('r2://b/k.wav', true)).toMatchObject({ state: 'ready', canMake: false });
  });

  it('is pending — never ready — when the derivative is missing or could not be checked', () => {
    expect(mp3Status('r2://b/k.wav', false)).toMatchObject({ state: 'pending', canMake: true });
    expect(mp3Status('r2://b/k.wav', null)).toMatchObject({ state: 'pending', canMake: true });
    for (const ext of ['flac', 'aiff', 'aif', 'm4a', 'ogg']) {
      expect(mp3Status(`r2://b/k.${ext}`, false).state).toBe('pending');
    }
  });

  it('says so when no MP3 can be made, and offers no button', () => {
    expect(mp3Status('r2://b/k.zip', false)).toMatchObject({ state: 'unsupported', canMake: false });
    expect(mp3Status(null, null)).toMatchObject({ state: 'no-audio', canMake: false });
    expect(mp3Status('', null).state).toBe('no-audio');
  });
});
