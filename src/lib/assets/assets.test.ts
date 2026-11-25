import { describe, expect, it } from 'vitest';
import {
  assetContentKey,
  assetsOfProject,
  assetsOfTrack,
  canSaveOffline,
  describeCacheId,
  locationOf,
  offlineCacheId,
  offlineLabel,
  offlineStateFor,
  resolveAssetSrc,
  withOfflineState,
} from './index';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

const track = { id: 't1', title: 'Night Shift', audio_url: 'r2://priv/t1.wav', wav_url: 'r2://priv/t1-master.wav' };

describe('assetContentKey', () => {
  it('is short, stable, and differs per reference', () => {
    const a = assetContentKey('r2://priv/a.wav');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(assetContentKey('r2://priv/a.wav')).toBe(a);
    expect(assetContentKey('r2://priv/b.wav')).not.toBe(a);
    expect(assetContentKey(null)).toBeNull();
    expect(assetContentKey('')).toBeNull();
  });
  it('never contains the reference', () => {
    expect(assetContentKey('r2://priv/secret-key.wav')).not.toContain('secret');
  });
});

describe('locationOf', () => {
  it('classifies by scheme', () => {
    expect(locationOf('r2://priv/k')).toBe('private');
    expect(locationOf('r2://pub/k', 'pub')).toBe('public');
    expect(locationOf('local://project-assets/k')).toBe('local');
    expect(locationOf('/uploads/a.mp3')).toBe('public');
    expect(locationOf('https://cdn.example/a.mp3')).toBe('public');
  });
});

describe('assetsOfTrack', () => {
  it('lists master, WAV and stems with owner-gated urls only', () => {
    const rows = assetsOfTrack(track, { vocals: 'r2://priv/v.wav', drums: null, bass: undefined, other: '/api/audio?src=x' });
    expect(rows.map((r) => r.id)).toEqual(['track:t1:audio', 'track:t1:wav', 'track:t1:stem:vocals', 'track:t1:stem:other']);
    for (const r of rows) {
      expect(r.openUrl).toMatch(/^\/api\/audio/);
      expect(r.offline).toBe('none');
    }
    expect(rows[0].location).toBe('private');
  });
  it('treats a WAV equal to the master as one file and skips missing audio', () => {
    expect(assetsOfTrack({ id: 'x', audio_url: 'r2://p/a', wav_url: 'r2://p/a' })).toHaveLength(1);
    expect(assetsOfTrack({ id: 'x', audio_url: null })).toEqual([]);
  });
  it('does not spread the row: only model fields appear', () => {
    const [a] = assetsOfTrack({ ...track, user_id: 'u', notes: 'private' } as typeof track);
    expect(Object.keys(a).sort()).toEqual(
      ['contentKey', 'fileName', 'id', 'kind', 'label', 'location', 'mime', 'offline', 'openUrl', 'ownerId', 'ownerType', 'playable', 'sizeBytes', 'source'].sort(),
    );
  });
});

const view = (over: Partial<ProjectAssetView> = {}): ProjectAssetView => ({
  id: 'a1', project_id: 'p1', kind: 'audio', label: 'Ref', file_name: 'ref.wav', mime: 'audio/wav', size_bytes: 1024,
  position: 0, in_portal: false, portal_at: null, created_at: '2026-11-01T00:00:00Z', downloadUrl: '/api/projects/p1/assets/a1/download', ...over,
});

describe('assetsOfProject', () => {
  it('maps a file through its download route and marks audio playable', () => {
    const [a] = assetsOfProject([view()]);
    expect(a).toMatchObject({ id: 'project:p1:file:a1', source: 'project_file', kind: 'audio', playable: true, location: 'private', openUrl: '/api/projects/p1/assets/a1/download', sizeBytes: 1024 });
  });
  it('documents are not playable or savable offline', () => {
    const [a] = assetsOfProject([view({ kind: 'document', mime: 'application/pdf' })]);
    expect(a.playable).toBe(false);
    expect(canSaveOffline(a)).toBe(false);
    expect(offlineStateFor(a, { contentKey: null })).toBe('unsupported');
  });
  it('a replaced file changes the fingerprint', () => {
    const [a] = assetsOfProject([view()]);
    const [b] = assetsOfProject([view({ size_bytes: 2048 })]);
    expect(a.contentKey).not.toBe(b.contentKey);
  });
});

describe('offline state', () => {
  const [master] = assetsOfTrack(track);
  it('none / saved / stale', () => {
    expect(offlineStateFor(master, null)).toBe('none');
    expect(offlineStateFor(master, { contentKey: master.contentKey })).toBe('saved');
    expect(offlineStateFor(master, { contentKey: 'ffffffffffff' })).toBe('stale');
  });
  it('a row saved before fingerprints existed reads as current, never stale', () => {
    expect(offlineStateFor(master, {})).toBe('saved');
    expect(offlineStateFor(master, { contentKey: null })).toBe('saved');
  });
  it('stale needs both keys', () => {
    expect(offlineStateFor({ ...master, contentKey: null }, { contentKey: 'abc' })).toBe('saved');
  });
  it('withOfflineState keys master by track id and others by asset id', () => {
    const rows = assetsOfTrack(track, { vocals: 'r2://priv/v.wav' });
    const cached = new Map([
      ['t1', { id: 't1', size: 1, contentKey: master.contentKey }],
      ['track:t1:stem:vocals', { id: 'track:t1:stem:vocals', size: 1, contentKey: 'ffffffffffff' }],
    ]);
    const out = withOfflineState(rows, offlineCacheId, cached);
    expect(out.map((r) => r.offline)).toEqual(['saved', 'none', 'stale']);
  });
  it('labels', () => {
    expect(offlineLabel('saved')).toBe('Available offline');
    expect(offlineLabel('stale')).toBe('Offline copy out of date');
    expect(offlineLabel('none')).toBe('Online only');
    expect(offlineLabel('unsupported')).toBeNull();
  });
  it('describeCacheId', () => {
    expect(describeCacheId('abc').kind).toBe('track');
    expect(describeCacheId('track:t1:stem:vocals').kind).toBe('stem');
    expect(describeCacheId('project:p1:file:a1').kind).toBe('project_file');
  });
});

describe('resolveAssetSrc', () => {
  it('uses the saved copy only when current; never a stale one', () => {
    expect(resolveAssetSrc({ openUrl: '/api/audio?src=x', offline: 'saved' }, 'blob:1')).toBe('blob:1');
    expect(resolveAssetSrc({ openUrl: '/api/audio?src=x', offline: 'stale' }, 'blob:1')).toBe('/api/audio?src=x');
    expect(resolveAssetSrc({ openUrl: '/api/audio?src=x', offline: 'none' }, null)).toBe('/api/audio?src=x');
    expect(resolveAssetSrc({ openUrl: null, offline: 'none' }, null)).toBe('');
  });
});
