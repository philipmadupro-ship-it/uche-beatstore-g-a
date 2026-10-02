// @vitest-environment jsdom
/**
 * /store/account/[token] (the legacy 24h delivery link) — playing a beat.
 *
 * Real page, real `usePlayer` store, data endpoints stubbed. The identity is
 * the link's token, not a session: audio and play logs must ask as
 * `token=<encoded>`, even when this device also holds a session marker.
 */
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlayer } from '@/hooks/usePlayer';

vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: () => null }));
vi.mock('@/components/ui/CoverImage', () => ({ CoverImage: () => null }));

import AccountPage from './page';

const TOKEN = 'tok.en+1/x';
const ENC = encodeURIComponent(TOKEN);
const FAV = '11111111-1111-4111-8111-111111111111';
const OWNED = '33333333-3333-4333-8333-333333333333';

const sum = (id: string, title: string) => ({
  id, title, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 120,
});

const purchases = (revoked = false) => ({
  email: 'buyer@example.com',
  project_bundles: [],
  track_licenses: [{
    id: 'lp1', kind: 'track', amount_usd: 300, created_at: '2026-09-01T00:00:00Z', status: 'paid',
    stripe_session_id: 'cs_1', download_url: revoked ? null : '/store/download?session_id=cs_1',
    access_revoked: revoked,
    items: [{ track_id: OWNED, license_id: 'excl', license_type: 'exclusive', title: 'Cold Front', duration_seconds: 200, bpm: 90 }],
  }],
});

const library = {
  email: 'buyer@example.com',
  history: [],
  favorites: [{ track_id: FAV, created_at: '2026-09-02T00:00:00Z', track: sum(FAV, 'Night Shift') }],
  playlists: [],
};

let posted: Array<{ url: string; body: Record<string, unknown> }> = [];
const plays = () => posted.filter((p) => p.body.action === 'log_play').map((p) => p.body.track_id);

/** A settled thenable: React's `use` reads it synchronously instead of suspending. */
const settled = <T,>(value: T) =>
  Object.assign(Promise.resolve(value), { status: 'fulfilled' as const, value });

function mount(revoked = false) {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    const body = url.startsWith('/api/store/account/') ? purchases(revoked) : library;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <AccountPage params={settled({ token: TOKEN })} />
      </Suspense>
    </QueryClientProvider>,
  );
}

const player = () => usePlayer.getState();

beforeEach(() => {
  posted = [];
  window.localStorage.clear();
  usePlayer.setState({ currentTrack: null, queue: [], isPlaying: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('/store/account/[token] playback', () => {
  it('plays a favourite from the token-gated route and logs it as the token', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Night Shift'));
    expect(player().currentTrack?.id).toBe(FAV);
    expect(player().currentTrack?.audio_url).toBe(`/api/store/me/preview/${FAV}?token=${ENC}`);
    expect(player().isPlaying).toBe(true);
    await waitFor(() => expect(plays()).toEqual([FAV]));
    expect(posted[0].url).toBe(`/api/store/me?token=${ENC}`);
  });

  it('plays a purchased beat, and pausing it does not log again', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Cold Front'));
    expect(player().currentTrack).toMatchObject({ id: OWNED, duration_seconds: 200, bpm: 90 });
    fireEvent.click(await screen.findByLabelText('Pause Cold Front'));
    expect(player().isPlaying).toBe(false);
    await waitFor(() => expect(plays()).toEqual([OWNED]));
    await new Promise((r) => setTimeout(r, 20));
    expect(plays()).toEqual([OWNED]);
  });

  it('keeps the token identity even when a session marker is also on the device', async () => {
    window.localStorage.setItem('antigravity-buyer-session-mode', '1');
    mount();
    fireEvent.click(await screen.findByLabelText('Play Night Shift'));
    await waitFor(() => expect(plays()).toEqual([FAV]));
    expect(posted[0].url).toBe(`/api/store/me?token=${ENC}`);
  });

  it('offers no play on a revoked purchase', async () => {
    mount(true);
    await screen.findByText(/Access revoked/);
    expect(screen.queryByLabelText('Play Cold Front')).toBeNull();
  });
});
