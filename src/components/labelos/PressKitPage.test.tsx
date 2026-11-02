// @vitest-environment jsdom

/**
 * The page behind a press link (LABEL-66): one plain message for a link that
 * does not work, a title and a line before the embargo, and — for a live kit —
 * a player only when the server sent audio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PressKitPage } from './PressKitPage';

let status = 200;
let payload: unknown;

beforeEach(() => {
  status = 200;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const live = (over: Record<string, unknown> = {}) => ({
  press: {
    state: 'live', title: 'Night Shift', artist: 'Nova', type: 'single', label: 'Label L', genre: 'Pop', releaseDate: '2026-10-01', released: true,
    headline: 'Nova returns', bio: 'A bio', links: [{ label: 'Instagram', url: 'https://instagram.com/nova' }], photos: [], tracklist: [{ position: 1, title: 'Night Shift', explicit: false }], listen: null, ...over,
  },
});

describe('the press page', () => {
  it('one plain message for a link that does not work', async () => {
    status = 404;
    payload = { error: 'Not found' };
    render(<PressKitPage token="t" />);
    expect(await screen.findByTestId('press-gone')).toBeTruthy();
  });

  it('before the embargo: the title, the line and the marked photos, no bio or player', async () => {
    payload = { press: { state: 'embargoed', title: 'Night Shift', artist: 'Nova', note: 'Coming soon', photos: [{ id: 'p', url: '/api/press/t/assets/p', caption: 'Cover' }] } };
    render(<PressKitPage token="t" />);
    expect(await screen.findByTestId('press-embargoed')).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Night Shift' })).toBeTruthy();
    expect(screen.queryByText('Bio')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/press/t/assets/p');
  });

  it('a live kit without audio has no player; with audio it has the store’s stream', async () => {
    payload = live();
    const { unmount } = render(<PressKitPage token="t" />);
    expect(await screen.findByTestId('press-live')).toBeTruthy();
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByText('A bio')).toBeTruthy();
    unmount();
    payload = live({ listen: { tracks: [{ id: 'i', title: 'Night Shift', audioUrl: '/api/store/releases/r/audio/i', durationSeconds: 100 }] } });
    render(<PressKitPage token="t" />);
    await screen.findByTestId('press-listen');
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/store/releases/r/audio/i');
  });

  it('links open in a new tab without a referrer', async () => {
    payload = live();
    render(<PressKitPage token="t" />);
    const a = (await screen.findByText('Instagram')).closest('a')!;
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(a.getAttribute('target')).toBe('_blank');
  });
});
