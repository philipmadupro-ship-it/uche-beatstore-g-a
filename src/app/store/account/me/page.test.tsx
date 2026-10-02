// @vitest-environment jsdom
/**
 * /store/account/me — playing a beat from the account.
 *
 * Runs the real page against the real `usePlayer` store (the one the store
 * layout's PlayerBar reads), with the two data endpoints stubbed. The bug this
 * guards: every beat on this page was a link and nothing could reach the
 * player, so an owned or favourited beat could not be heard from the account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlayer } from '@/hooks/usePlayer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { email: 'buyer@example.com' } } }), signOut: vi.fn() },
  }),
}));
vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: () => null }));
vi.mock('@/components/ui/CoverImage', () => ({ CoverImage: () => null }));

import BuyerMePage from './page';

const FAV = '11111111-1111-4111-8111-111111111111';
const FAV2 = '22222222-2222-4222-8222-222222222222';
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
  favorites: [
    { track_id: FAV, created_at: '2026-09-02T00:00:00Z', track: sum(FAV, 'Night Shift') },
    { track_id: 'gone', created_at: '2026-09-02T00:00:00Z', track: null },
    { track_id: FAV2, created_at: '2026-09-02T00:00:00Z', track: sum(FAV2, 'Low Light') },
  ],
  playlists: [{
    id: 'pl1', name: 'Mine', created_at: '', updated_at: '2026-09-03T00:00:00Z',
    track_ids: [FAV2], tracks: [sum(FAV2, 'Low Light')],
  }],
};

function mount(revoked = false) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = url.startsWith('/api/store/account/me') ? purchases(revoked) : library;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BuyerMePage /></QueryClientProvider>);
}

const player = () => usePlayer.getState();

beforeEach(() => {
  usePlayer.setState({ currentTrack: null, queue: [], isPlaying: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('/store/account/me playback', () => {
  it('plays a favourite through the global player, from the identity-gated route', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Night Shift'));
    expect(player().currentTrack?.id).toBe(FAV);
    expect(player().currentTrack?.audio_url).toBe(`/api/store/me/preview/${FAV}?session=1`);
    expect(player().isPlaying).toBe(true);
  });

  it('queues the list it was pressed in, skipping unavailable rows', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Night Shift'));
    expect(player().queue.map((t) => t.id)).toEqual([FAV, FAV2]);
  });

  it('pressing the playing beat pauses it, and the label follows', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Night Shift'));
    fireEvent.click(await screen.findByLabelText('Pause Night Shift'));
    expect(player().isPlaying).toBe(false);
    expect(await screen.findByLabelText('Play Night Shift')).toBeTruthy();
  });

  it('plays a beat the buyer owns, with the length the purchase carries', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Play Cold Front'));
    expect(player().currentTrack).toMatchObject({
      id: OWNED, duration_seconds: 200, bpm: 90,
      audio_url: `/api/store/me/preview/${OWNED}?session=1`,
    });
  });

  it('plays a beat from inside a playlist', async () => {
    mount();
    await screen.findByText('My library');
    const inPlaylist = (await screen.findAllByLabelText('Play Low Light')).at(-1)!;
    fireEvent.click(inPlaylist);
    expect(player().currentTrack?.id).toBe(FAV2);
    expect(player().queue.map((t) => t.id)).toEqual([FAV2]);
  });

  it('offers no play on a revoked purchase', async () => {
    mount(true);
    await screen.findByText(/Access revoked/);
    expect(screen.queryByLabelText('Play Cold Front')).toBeNull();
  });

  it('keeps every beat link a link, with the play button beside it, not inside', async () => {
    const { container } = mount();
    await screen.findByLabelText('Play Night Shift');
    expect(container.querySelectorAll('a button, button a').length).toBe(0);
    await waitFor(() => expect(screen.getByLabelText('Open Night Shift').getAttribute('href')).toBe(`/store/${FAV}`));
  });
});
