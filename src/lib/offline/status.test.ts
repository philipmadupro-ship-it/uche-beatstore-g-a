import { describe, it, expect } from 'vitest';
import {
  deriveOfflineStatus,
  offlineActionLabel,
  offlineStatusAnnouncement,
  offlineRemovedAnnouncement,
  formatOfflineSize,
} from './status';

describe('deriveOfflineStatus', () => {
  it('is idle when nothing has happened yet', () => {
    expect(deriveOfflineStatus({ isCached: false, downloading: false, error: null })).toBe('idle');
  });

  it('is downloading regardless of cached/error, since a re-save is in flight', () => {
    expect(deriveOfflineStatus({ isCached: true, downloading: true, error: 'stale' })).toBe('downloading');
  });

  it('is cached once a copy exists and nothing is in flight', () => {
    expect(deriveOfflineStatus({ isCached: true, downloading: false, error: null })).toBe('cached');
  });

  it('is error when a save failed and no copy resulted', () => {
    expect(deriveOfflineStatus({ isCached: false, downloading: false, error: 'Network error' })).toBe('error');
  });
});

describe('offlineActionLabel', () => {
  it('shows a rounded percentage while downloading', () => {
    expect(offlineActionLabel('downloading', 0.5)).toBe('Saving offline… 50%');
    expect(offlineActionLabel('downloading', 0.999)).toBe('Saving offline… 100%');
  });

  it('offers removal once cached', () => {
    expect(offlineActionLabel('cached', 0)).toBe('Remove offline copy');
  });

  it('offers a retry after a failure', () => {
    expect(offlineActionLabel('error', 0)).toBe('Retry save offline');
  });

  it('offers the initial save action when idle', () => {
    expect(offlineActionLabel('idle', 0)).toBe('Save offline');
  });
});

describe('offlineStatusAnnouncement', () => {
  it('announces the start of a save', () => {
    expect(offlineStatusAnnouncement('downloading', { title: 'Night Shift' }))
      .toBe('Saving "Night Shift" for offline playback…');
  });

  it('announces completion with size when known', () => {
    expect(offlineStatusAnnouncement('cached', { title: 'Night Shift', sizeLabel: '4.2 MB' }))
      .toBe('"Night Shift" saved offline · 4.2 MB.');
  });

  it('announces completion without size when unknown', () => {
    expect(offlineStatusAnnouncement('cached', { title: 'Night Shift' }))
      .toBe('"Night Shift" saved offline.');
  });

  it('announces failure with the error message when present', () => {
    expect(offlineStatusAnnouncement('error', { title: 'Night Shift', error: 'HTTP 500' }))
      .toBe('Couldn\'t save "Night Shift" offline: HTTP 500.');
  });

  it('announces failure without detail when the error message is missing', () => {
    expect(offlineStatusAnnouncement('error', { title: 'Night Shift' }))
      .toBe('Couldn\'t save "Night Shift" offline.');
  });

  it('has nothing to say for idle — it cannot tell "never saved" from "just removed"', () => {
    expect(offlineStatusAnnouncement('idle', { title: 'Night Shift' })).toBeNull();
  });
});

describe('offlineRemovedAnnouncement', () => {
  it('names the removed track explicitly', () => {
    expect(offlineRemovedAnnouncement('Night Shift')).toBe('"Night Shift" removed from offline storage.');
  });
});

describe('formatOfflineSize', () => {
  it('formats bytes as MB to one decimal', () => {
    expect(formatOfflineSize(4.2 * 1024 * 1024)).toBe('4.2 MB');
  });
});
