// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const identity = { current: null as null | { query: string; mode: 'session' | 'token' } };
type Result = { ok: boolean; data?: unknown; error?: string };
const addToPlaylist = vi.fn<(p: string, t: string) => Promise<Result>>(async () => ({ ok: true }));
const removeFromPlaylist = vi.fn<(p: string, t: string) => Promise<Result>>(async () => ({ ok: true }));
const createPlaylist = vi.fn<(n: string) => Promise<Result>>(async () => ({ ok: true, data: { playlist: { id: 'new-pl' } } }));
const fetchBuyerLibrary = vi.fn(async () => ({
  email: 'b@x.test',
  history: [],
  favorites: [],
  playlists: [
    { id: 'p1', name: 'Late night', created_at: '', updated_at: '', track_ids: ['beat'], tracks: [] },
    { id: 'p2', name: 'Gym', created_at: '', updated_at: '', track_ids: [], tracks: [] },
  ],
}));

vi.mock('@/lib/buyer-session', () => ({
  buyerIdentityQuery: () => identity.current,
  fetchBuyerLibrary: () => fetchBuyerLibrary(),
  addToPlaylist: (p: string, t: string) => addToPlaylist(p, t),
  removeFromPlaylist: (p: string, t: string) => removeFromPlaylist(p, t),
  createPlaylist: (n: string) => createPlaylist(n),
}));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddToPlaylistMenu } from './AddToPlaylistMenu';

beforeEach(() => {
  identity.current = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

async function openMenu() {
  render(<AddToPlaylistMenu trackId="beat" trackTitle="Night Shift" />);
  const trigger = await screen.findByRole('button', { name: 'Add to project' });
  await waitFor(() => expect(fetchBuyerLibrary).toHaveBeenCalled());
  fireEvent.click(trigger);
  return screen.findByRole('menu');
}

describe('AddToPlaylistMenu', () => {
  it('renders nothing and fetches nothing for an anonymous visitor', () => {
    const { container } = render(<AddToPlaylistMenu trackId="beat" trackTitle="x" />);
    expect(container.innerHTML).toBe('');
    expect(fetchBuyerLibrary).not.toHaveBeenCalled();
  });

  it('adds the beat to a playlist that does not hold it', async () => {
    identity.current = { query: 'session=1', mode: 'session' };
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Gym/ }));
    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith('p2', 'beat'));
    expect(removeFromPlaylist).not.toHaveBeenCalled();
  });

  it('removes the beat from a playlist that already holds it', async () => {
    identity.current = { query: 'session=1', mode: 'session' };
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Late night/ }));
    await waitFor(() => expect(removeFromPlaylist).toHaveBeenCalledWith('p1', 'beat'));
  });

  it('creates a playlist named after the beat and puts the beat in it', async () => {
    identity.current = { query: 'session=1', mode: 'session' };
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New project with this beat/ }));
    await waitFor(() => expect(addToPlaylist).toHaveBeenCalledWith('new-pl', 'beat'));
    expect(createPlaylist).toHaveBeenCalledWith('Night Shift');
  });
});
