import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME,
  applyVolume,
  clampVolume,
  isSilent,
  migratePersistedVolume,
  outputVolume,
  toggleMuted,
} from './player-volume';

describe('player volume and mute are independent', () => {
  it('muting keeps the level, unmuting restores it', () => {
    const muted = toggleMuted({ volume: 0.35, muted: false });
    expect(muted).toEqual({ volume: 0.35, muted: true });
    expect(toggleMuted(muted)).toEqual({ volume: 0.35, muted: false });
  });

  it('unmuting a level of zero comes back audible, not silent', () => {
    expect(toggleMuted({ volume: 0, muted: true })).toEqual({ volume: DEFAULT_VOLUME, muted: false });
  });

  it('raising the level while muted unmutes; lowering to zero leaves the flag alone', () => {
    expect(applyVolume({ volume: 0.5, muted: true }, 0.6)).toEqual({ volume: 0.6, muted: false });
    expect(applyVolume({ volume: 0.5, muted: true }, 0)).toEqual({ volume: 0, muted: true });
    expect(applyVolume({ volume: 0.5, muted: false }, 0)).toEqual({ volume: 0, muted: false });
  });

  it('clamps to 0..1 and treats non-finite input as the default', () => {
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
  });

  it('outputs zero while muted whatever the level, duck or normalisation', () => {
    expect(outputVolume({ volume: 1, muted: true }, 1, 1)).toBe(0);
    expect(outputVolume({ volume: 0.5, muted: false }, 0.5, 0.8)).toBeCloseTo(0.2);
    expect(outputVolume({ volume: 1, muted: false }, 1, 1.5)).toBe(1);
  });

  it('reads silence from either the flag or a zero level', () => {
    expect(isSilent({ volume: 0.5, muted: true })).toBe(true);
    expect(isSilent({ volume: 0, muted: false })).toBe(true);
    expect(isSilent({ volume: 0.5, muted: false })).toBe(false);
  });
});

describe('migratePersistedVolume', () => {
  it('reads a pre-flag mute (volume 0) as muted at the default level', () => {
    expect(migratePersistedVolume({ volume: 0 })).toEqual({ volume: DEFAULT_VOLUME, muted: true });
  });

  it('keeps an ordinary level unmuted', () => {
    expect(migratePersistedVolume({ volume: 0.4 })).toEqual({ volume: 0.4, muted: false });
  });

  it('trusts a stored flag', () => {
    expect(migratePersistedVolume({ volume: 0.4, muted: true })).toEqual({ volume: 0.4, muted: true });
  });

  it('falls back to defaults for missing or malformed state', () => {
    expect(migratePersistedVolume(undefined)).toEqual({ volume: DEFAULT_VOLUME, muted: false });
    expect(migratePersistedVolume({ volume: 'loud' })).toEqual({ volume: DEFAULT_VOLUME, muted: false });
  });
});
