import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/share-media-token', () => ({
  signedSharePreviewUrl: (token: string, id: string) => `/api/share/${token}/preview/${id}?expires=1&sig=x`,
}));
vi.mock('@/lib/audio/cdn', () => ({ cdnAudioSrc: (u: string) => u }));

import {
  isFullPlayback, isMissingPlaybackColumn, playbackLabel, sharePlaybackSource, writeWithPlayback,
} from './playback';
import { sharePlaybackUrl } from './playback-url';

const track = {
  id: 't1',
  audio_url: 'r2://private/masters/t1.wav',
  preview_url: 'https://pub.r2.dev/previews/t1.mp3',
};

describe('isFullPlayback', () => {
  it('defaults to full: missing column, null, true', () => {
    expect(isFullPlayback(undefined)).toBe(true);
    expect(isFullPlayback({})).toBe(true);
    expect(isFullPlayback({ full_playback: null })).toBe(true);
    expect(isFullPlayback({ full_playback: true })).toBe(true);
  });

  it('only an explicit false limits the share to the preview', () => {
    expect(isFullPlayback({ full_playback: false })).toBe(false);
  });
});

describe('sharePlaybackSource', () => {
  it('full streams the master even when a 75 s clip exists (the PR #17 regression)', () => {
    expect(sharePlaybackSource(track, true)).toBe('r2://private/masters/t1.wav');
  });

  it('preview streams the clip', () => {
    expect(sharePlaybackSource(track, false)).toBe('https://pub.r2.dev/previews/t1.mp3');
  });

  it('falls back rather than going silent', () => {
    expect(sharePlaybackSource({ audio_url: null, preview_url: 'clip' }, true)).toBe('clip');
    expect(sharePlaybackSource({ audio_url: 'master', preview_url: null }, false)).toBe('master');
    expect(sharePlaybackSource({}, true)).toBeNull();
  });
});

describe('sharePlaybackUrl', () => {
  it('full never hands out the CDN clip, only the signed grant route', () => {
    expect(sharePlaybackUrl(track, 'tok', true)).toBe('/api/share/tok/preview/t1?expires=1&sig=x');
  });

  it('preview may use the public clip directly', () => {
    expect(sharePlaybackUrl(track, 'tok', false)).toBe('https://pub.r2.dev/previews/t1.mp3');
  });

  it('preview without a public clip goes through the grant route', () => {
    expect(sharePlaybackUrl({ id: 't1', preview_url: null }, 'tok', false)).toBe('/api/share/tok/preview/t1?expires=1&sig=x');
  });

  it('never leaks a private r2:// reference', () => {
    expect(sharePlaybackUrl({ id: 't1', preview_url: 'r2://private/x.mp3' }, 'tok', false)).not.toContain('r2://');
  });
});

describe('playbackLabel', () => {
  it('names both modes', () => {
    expect(playbackLabel(true)).toBe('Full track');
    expect(playbackLabel(false)).toBe('Preview · 1:15');
  });
});

describe('writeWithPlayback (migration 121 may not be applied)', () => {
  const missing = { code: 'PGRST204', message: "Could not find the 'full_playback' column of 'share_links' in the schema cache" };

  it('writes once with the column when it exists', async () => {
    const calls: unknown[] = [];
    const res = await writeWithPlayback(false, async (f) => { calls.push(f); return { error: null, data: 1 }; });
    expect(calls).toEqual([{ full_playback: false }]);
    expect(res.error).toBeNull();
  });

  it('full + missing column: retries without it (full is the default anyway)', async () => {
    const calls: unknown[] = [];
    const res = await writeWithPlayback(true, async (f) => {
      calls.push(f);
      return 'full_playback' in f ? { error: missing, data: null } : { error: null, data: 1 };
    });
    expect(calls).toEqual([{ full_playback: true }, {}]);
    expect(res.error).toBeNull();
  });

  it('preview + missing column: refuses rather than silently sharing the full track', async () => {
    const calls: unknown[] = [];
    const res = await writeWithPlayback(false, async (f) => { calls.push(f); return { error: missing, data: null }; });
    expect(calls).toHaveLength(1);
    expect(res.error?.code).toBe('PLAYBACK_MIGRATION');
  });

  it('not specified: never sends the column', async () => {
    const calls: unknown[] = [];
    await writeWithPlayback(undefined, async (f) => { calls.push(f); return { error: null }; });
    expect(calls).toEqual([{}]);
  });

  it('other errors pass through untouched', async () => {
    const other = { code: '23505', message: 'duplicate key' };
    const res = await writeWithPlayback(true, async () => ({ error: other }));
    expect(res.error).toBe(other);
    expect(isMissingPlaybackColumn(other)).toBe(false);
  });
});
