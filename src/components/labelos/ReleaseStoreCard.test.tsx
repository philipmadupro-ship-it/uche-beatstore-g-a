// @vitest-environment jsdom

/**
 * The release's "On the store" card (LABEL-42): it offers listing only where
 * the server says it can apply, says why when it cannot, asks about deleting
 * previews only when the server says the owner has that choice, and sends the
 * playback the member picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleaseStoreCard } from './ReleaseStoreCard';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirmToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let calls: { url: string; method: string; body: unknown }[];
let state: Record<string, unknown>;

const base = {
  listed: false, listedAt: null, playback: 'preview', playbackChoice: true,
  canList: { ok: true }, unlist: { askToDeletePreviews: false },
};

beforeEach(() => {
  calls = [];
  state = { ...base };
  confirmToast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, json: async () => (method === 'GET' ? state : { listed: true, playback: 'full', promoted: 0 }) } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (canWrite = true, canManagePublic = true, imported = false) =>
  render(<ReleaseStoreCard orgId="o1" releaseId="r1" canWrite={canWrite} canManagePublic={canManagePublic} imported={imported} />);

describe('ReleaseStoreCard', () => {
  it('lists with the playback the member picked', async () => {
    mount();
    await screen.findByTestId('release-store');
    fireEvent.click(screen.getByTestId('release-store-playback-full'));
    fireEvent.click(screen.getByTestId('release-store-list'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/org/o1/releases/r1/store', body: { listed: true, playback: 'full' } });
  });

  it('draws nothing where the org can never list (a label-owned release)', async () => {
    state = { ...base, canList: { ok: false, error: 'nope', field: 'org' } };
    mount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('release-store')).toBeNull();
  });

  it('says why an unreleased release cannot be listed, and offers no button', async () => {
    state = { ...base, canList: { ok: false, error: 'Only a released release can be listed', field: 'state' } };
    mount();
    expect((await screen.findByTestId('release-store-blocked')).textContent).toMatch(/released release/);
    expect(screen.queryByTestId('release-store-list')).toBeNull();
  });

  it('unlisting music that was out asks nothing and keeps the previews', async () => {
    state = { ...base, listed: true, unlist: { askToDeletePreviews: false } };
    mount();
    fireEvent.click(await screen.findByTestId('release-store-unlist'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: false, delete_previews: false });
  });

  it('unlisting music that was never out asks the owner, and sends the answer', async () => {
    state = { ...base, listed: true, unlist: { askToDeletePreviews: true } };
    confirmToast.mockResolvedValue(true);
    mount();
    fireEvent.click(await screen.findByTestId('release-store-unlist'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: false, delete_previews: true });
  });

  it('a member who cannot write sees the state and no buttons', async () => {
    state = { ...base, listed: true };
    mount(false);
    expect((await screen.findByTestId('release-store-state')).textContent).toMatch(/Listed/);
    expect(screen.queryByTestId('release-store-unlist')).toBeNull();
  });

  it('an A&R cannot choose full songs: the button is off and says why', async () => {
    mount(true, false);
    await screen.findByTestId('release-store');
    expect((screen.getByTestId('release-store-playback-full') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('release-store-full-locked')).toBeTruthy();
    expect((screen.getByTestId('release-store-playback-preview') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an imported release is the owner’s: an A&R sees the reason and no list / unlist button', async () => {
    state = { ...base, listed: true };
    mount(true, false, true);
    expect((await screen.findByTestId('release-store-owner-only')).textContent).toMatch(/only an owner or an admin/);
    expect(screen.queryByTestId('release-store-unlist')).toBeNull();
    expect(screen.queryByTestId('release-store-list')).toBeNull();
    cleanup();
    mount(true, true, true);
    expect(await screen.findByTestId('release-store-unlist')).toBeTruthy();
  });

  it('a non-manager never starts on a disabled "full": an unlisted release with a stale full shows preview selected', async () => {
    state = { ...base, listed: false, playback: 'full' };
    mount(true, false);
    await screen.findByTestId('release-store');
    expect(screen.getByTestId('release-store-playback-preview').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('release-store-playback-full').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('release-store-list'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: true, playback: 'preview' });
  });
});
