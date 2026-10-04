// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: () => <span data-testid="art" /> }));
const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { usePlayer } from '@/hooks/usePlayer';
import { BuyerBeatsWorkspace } from './BuyerBeatsWorkspace';
import type { BuyerBeat } from '@/lib/store/buyer-workspace';

const beat = (id: string, over: Partial<BuyerBeat> = {}): BuyerBeat => ({
  id, title: `Beat ${id}`, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 100,
  status: 'owned', since: '2026-09-10T00:00:00Z', license: 'lease',
  offer: null, listed: true, playable: true, canAddToProject: true, openUrl: `/store/download?session_id=${id}`, available: true,
  ...over,
});

const BEATS: BuyerBeat[] = [
  beat('night', { title: 'Night Shift', bpm: 140 }),
  beat('cold', { title: 'Cold Front', bpm: 92, key: 'C', scale: 'major', since: '2026-09-11T00:00:00Z' }),
  beat('ask', {
    title: 'Asked For', status: 'requested', license: null, openUrl: null, bpm: 120, since: '2026-09-12T00:00:00Z',
    offer: { status: 'pending', price_usd: 300 },
  }),
  beat('gone', { title: 'Delisted One', listed: false, playable: true, openUrl: '/store/download?session_id=gone', since: '2026-09-01T00:00:00Z' }),
];

let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(respond(url, init)));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BuyerBeatsWorkspace /></QueryClientProvider>);
}
const titles = () => screen.getAllByRole('listitem').map((li) => within(li).getByText(/^(Night Shift|Cold Front|Asked For|Delisted One)$/).textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  respond = (url) => (url.includes('view=beats') ? json({ email: 'a@b.test', beats: BEATS }) : json({ ok: true }));
  usePlayer.setState({ currentTrack: null, queue: [], isPlaying: false });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('BuyerBeatsWorkspace', () => {
  it('shows a loading state, then the beats newest first with their status', async () => {
    mount();
    expect(screen.getByRole('status', { name: 'Loading your beats' })).toBeTruthy();
    await screen.findByText('Night Shift');
    expect(titles()).toEqual(['Asked For', 'Cold Front', 'Night Shift', 'Delisted One']);
    expect(screen.getAllByText('Owned · Lease').length).toBeGreaterThan(0);
    expect(screen.getByText('Offer $300 · pending')).toBeTruthy();
    expect(screen.getByText(/Your sound · /)).toBeTruthy();
  });

  it('empty account: says so and links to the store', async () => {
    respond = () => json({ email: 'a@b.test', beats: [] });
    mount();
    expect(await screen.findByText('No beats yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse beats' }).getAttribute('href')).toBe('/store');
  });

  it('error state offers a retry that refetches', async () => {
    let fail = true;
    respond = () => (fail ? json({ error: 'boom' }, 500) : json({ email: 'a@b.test', beats: BEATS }));
    mount();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Night Shift')).toBeTruthy();
  });

  it('search narrows the list, and a miss offers Clear filters', async () => {
    mount();
    await screen.findByText('Night Shift');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cold' } });
    expect(titles()).toEqual(['Cold Front']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No beats match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toHaveLength(4);
  });

  it('filters by status and sorts, through the dropdowns', async () => {
    mount();
    await screen.findByText('Night Shift');
    fireEvent.click(screen.getByRole('button', { name: 'Filter beats' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Requested' }));
    expect(titles()).toEqual(['Asked For']);
    fireEvent.click(screen.getByRole('button', { name: 'Filter beats' }));
    fireEvent.click(await screen.findByRole('option', { name: 'All beats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort beats' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Title' }));
    expect(titles()).toEqual(['Asked For', 'Cold Front', 'Delisted One', 'Night Shift']);
  });

  it('plays a listed beat through the persistent player, queueing what is shown; pause toggles', async () => {
    mount();
    await screen.findByText('Night Shift');
    fireEvent.click(screen.getByRole('button', { name: 'Play Night Shift' }));
    const s = usePlayer.getState();
    expect(s.currentTrack?.id).toBe('night');
    expect(s.currentTrack?.audio_url).toBe('/api/store/me/preview/night?session=1');
    expect(s.isPlaying).toBe(true);
    // the owned-but-delisted beat is queued too: the buyer route streams it
    expect(s.queue.map((t) => t.id)).toEqual(['ask', 'cold', 'night', 'gone']);
    const pause = screen.getByRole('button', { name: 'Pause Night Shift' });
    fireEvent.click(pause);
    expect(usePlayer.getState().isPlaying).toBe(false);
  });

  it('an owned beat the store delisted still plays, keeps Open, and its title is not a dead storefront link', async () => {
    mount();
    await screen.findByText('Delisted One');
    const row = screen.getByText('Delisted One').closest('li')!;
    expect(within(row).getByRole('button', { name: /Play Delisted One/ })).toBeTruthy();
    expect(within(row).getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/store/download?session_id=gone');
    // /store/[id] 404s for a delisted beat, so the title must not link there
    expect(within(row).queryByRole('link', { name: 'Delisted One' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Play Delisted One/ }));
    expect(usePlayer.getState().currentTrack?.id).toBe('gone');
    expect(usePlayer.getState().currentTrack?.audio_url).toBe('/api/store/me/preview/gone?session=1');
  });

  it('a request on a beat that is no longer listed has no Play', async () => {
    respond = () => json({ email: 'a@b.test', beats: [beat('x', { title: 'Asked For', status: 'requested', canAddToProject: false, playable: false, available: false, openUrl: null, license: null, offer: { status: 'pending', price_usd: 5 } })] });
    mount();
    await screen.findByText('Asked For');
    expect(screen.queryByRole('button', { name: /Play Asked For/ })).toBeNull();
  });

  it('selecting beats reveals Create project, which posts the ids with the name, then clears', async () => {
    mount();
    await screen.findByText('Night Shift');
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Night Shift' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Delisted One' }));
    const form = screen.getByRole('form', { name: /Create a project/ });
    expect(within(form).getByText('2 selected')).toBeTruthy();
    const submit = within(form).getByRole('button', { name: /Create project/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // needs a name
    fireEvent.change(within(form).getByLabelText('Project name'), { target: { value: '  Mixtape ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/store/me?session=1');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: 'create_playlist', name: 'Mixtape', track_ids: ['night', 'gone'] });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('a failed create keeps the selection and says why', async () => {
    respond = (url, init) => (init?.method === 'POST' ? json({ error: 'Track not found' }, 404) : json({ email: 'a@b.test', beats: BEATS }));
    mount();
    await screen.findByText('Night Shift');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Night Shift' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Create project/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not create project', 'Track not found'));
    expect(screen.getByRole('form')).toBeTruthy();
  });

  it('a request on a delisted beat cannot be selected', async () => {
    respond = () => json({ email: 'a@b.test', beats: [beat('x', { title: 'Asked For', status: 'requested', canAddToProject: false, listed: false, playable: false, available: false, openUrl: null, license: null, offer: { status: 'pending', price_usd: 5 } })] });
    mount();
    await screen.findByText('Asked For');
    expect(screen.queryByRole('checkbox', { name: 'Select Asked For' })).toBeNull();
    // not owned and not listed: the preview route would 404, so no Play either
    expect(screen.queryByRole('button', { name: /Play Asked For/ })).toBeNull();
  });
});
