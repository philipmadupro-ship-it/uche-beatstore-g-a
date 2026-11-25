// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  getCachedMeta: vi.fn(),
  getOfflineSrc: vi.fn(),
  revokeOfflineSrc: vi.fn(),
}));
vi.mock('@/lib/offline/audio-cache', () => cache);

import { OfflineFirstAudio } from './OfflineFirstAudio';

const ONLINE = '/api/audio?src=' + encodeURIComponent('r2://priv/t1.wav');
const audio = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement;

beforeEach(() => {
  cache.getCachedMeta.mockReset();
  cache.getOfflineSrc.mockReset();
  cache.revokeOfflineSrc.mockReset();
});
afterEach(cleanup);

describe('OfflineFirstAudio', () => {
  it('plays online when nothing is saved', async () => {
    cache.getCachedMeta.mockResolvedValue(null);
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" contentKey="aaa" />);
    await Promise.resolve();
    expect(audio(container).getAttribute('src')).toBe(ONLINE);
  });

  it('swaps to a current saved copy', async () => {
    cache.getCachedMeta.mockResolvedValue({ id: 't1', contentKey: 'aaa' });
    cache.getOfflineSrc.mockResolvedValue('blob:saved');
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" contentKey="aaa" />);
    await waitFor(() => expect(audio(container).getAttribute('src')).toBe('blob:saved'));
    expect(audio(container).dataset.offline).toBe('true');
  });

  it('ignores a stale copy', async () => {
    cache.getCachedMeta.mockResolvedValue({ id: 't1', contentKey: 'old' });
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" contentKey="aaa" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.getOfflineSrc).not.toHaveBeenCalled();
    expect(audio(container).getAttribute('src')).toBe(ONLINE);
  });

  it('treats a row without a fingerprint as current', async () => {
    cache.getCachedMeta.mockResolvedValue({ id: 't1' });
    cache.getOfflineSrc.mockResolvedValue('blob:old-row');
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" contentKey="aaa" />);
    await waitFor(() => expect(audio(container).getAttribute('src')).toBe('blob:old-row'));
  });

  it('falls back to the online src if the saved copy fails to load (never silence)', async () => {
    cache.getCachedMeta.mockResolvedValue({ id: 't1', contentKey: 'aaa' });
    cache.getOfflineSrc.mockResolvedValue('blob:broken');
    const onError = vi.fn();
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" contentKey="aaa" onError={onError} />);
    await waitFor(() => expect(audio(container).getAttribute('src')).toBe('blob:broken'));
    fireEvent.error(audio(container));
    await waitFor(() => expect(audio(container).getAttribute('src')).toBe(ONLINE));
    expect(cache.revokeOfflineSrc).toHaveBeenCalledWith('t1');
    expect(onError).toHaveBeenCalled();
  });

  it('stays online when IndexedDB throws', async () => {
    cache.getCachedMeta.mockRejectedValue(new Error('no idb'));
    const { container } = render(<OfflineFirstAudio cacheId="t1" rawUrl="r2://priv/t1.wav" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(audio(container).getAttribute('src')).toBe(ONLINE);
  });
});
