// @vitest-environment jsdom

/**
 * The shared music of a connected artist org, as a label member sees it
 * (LABEL-41): playing goes through the label's own audio route, "Use in a label
 * song" appears only when the server said the member may copy, and a copy is
 * one POST to the label's copy route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePlayer } from '@/hooks/usePlayer';
import type { ConnectedMusic } from '@/lib/labelos/connections';
import { ConnectedMusicView } from './ConnectedMusicView';

const music = (canCopy: boolean): ConnectedMusic => ({
  connection: { id: 'c1', allowCopies: canCopy, shareMode: 'selected' },
  projects: [
    { id: 'p1', name: 'Nova demos', isInbox: false, recordings: [{ id: 't1', title: 'Night beat', type: 'beat', bpm: 140, key: 'F', scale: 'minor', durationSeconds: 125, canCopy }] },
    { id: 'p2', name: 'Empty', isInbox: true, recordings: [] },
  ],
});

const calls: { url: string; body: unknown }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ track: { id: 'new' } }), { status: 201 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectedMusicView', () => {
  it('lists the shared recordings and plays one through the label’s audio route', () => {
    render(<ConnectedMusicView orgId="lab" music={music(false)} />);
    expect(screen.getByText('Night beat')).toBeTruthy();
    expect(screen.getByText(/beat · 140 BPM · F minor · 2:05/)).toBeTruthy();
    expect(screen.getByText('No recordings you can hear in this project.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play Night beat' }));
    expect(usePlayer.getState().currentTrack?.audio_url).toBe('/api/org/lab/audio/t1?variant=full');
  });

  it('offers no copy unless the server allowed it', () => {
    render(<ConnectedMusicView orgId="lab" music={music(false)} />);
    expect(screen.queryByText('Use in a label song')).toBeNull();
  });

  it('copies with one POST and then says Copied', async () => {
    render(<ConnectedMusicView orgId="lab" music={music(true)} />);
    fireEvent.click(screen.getByText('Use in a label song'));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(calls).toEqual([{ url: '/api/org/lab/tracks/copy', body: { source: { kind: 'connection', track_id: 't1' } } }]);
  });

  it('says so when nothing is shared yet', () => {
    render(<ConnectedMusicView orgId="lab" music={{ connection: { id: 'c1', allowCopies: false, shareMode: 'selected' }, projects: [] }} />);
    expect(screen.getByText('Nothing is shared with you yet.')).toBeTruthy();
  });
});
