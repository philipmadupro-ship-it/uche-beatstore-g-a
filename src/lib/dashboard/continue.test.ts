import { describe, expect, it } from 'vitest';
import { pickUpWhereLeftOff } from './continue';

const t = (id: string) => ({ id, title: id });
const c = (id: string, at: string, extra = {}) => ({ id, name: id, updated_at: at, ...extra });

describe('pickUpWhereLeftOff', () => {
  it('leads with at most two recent tracks, then newest-touched projects and playlists', () => {
    const items = pickUpWhereLeftOff({
      recentTracks: [t('a'), t('b'), t('c')],
      projects: [c('p-old', '2026-01-01'), c('p-new', '2026-11-20')],
      playlists: [c('pl', '2026-11-10')],
    });
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['track:a', 'track:b', 'project:p-new', 'playlist:pl', 'project:p-old']);
  });
  it('skips archived projects and repeated tracks', () => {
    const items = pickUpWhereLeftOff({
      recentTracks: [t('a'), t('a')],
      projects: [c('gone', '2026-11-20', { status: 'archived' })],
      playlists: [],
    });
    expect(items.map((i) => i.id)).toEqual(['a']);
  });
  it('falls back to created_at and caps at the limit', () => {
    const items = pickUpWhereLeftOff({
      recentTracks: [],
      projects: [{ id: 'x', name: 'x', created_at: '2026-05-01' }],
      playlists: Array.from({ length: 9 }, (_, i) => c(`p${i}`, `2026-06-0${i + 1}`)),
    });
    expect(items).toHaveLength(6);
    expect(items[0].id).toBe('p8');
  });
  it('is empty when there is nothing', () => {
    expect(pickUpWhereLeftOff({ recentTracks: [], projects: [], playlists: [] })).toEqual([]);
  });
});
