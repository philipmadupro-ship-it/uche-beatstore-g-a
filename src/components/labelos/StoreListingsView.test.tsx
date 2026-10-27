// @vitest-environment jsdom

/**
 * Store listings (LABEL-71): the artist answers yes / no (a no is confirmed first and goes to the server as
 * exactly `{ decision: 'no' }`), and only the store owner's view has the connected-artists list, with Unlist
 * and Allow again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreListingsView } from './StoreListingsView';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirmToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast }));

let calls: { url: string; method: string; body: unknown }[];
let consents: Record<string, unknown>[];
let connected: { status: number; body: Record<string, unknown> };

const consent = (over: Record<string, unknown> = {}) => ({
  releaseId: 'r1', title: 'Night Shift', type: 'album', releaseDate: '2024-02-02', listed: true, releaseState: 'delivered',
  state: 'proposed', proposedAt: '2026-10-01T00:00:00Z', decidedAt: null, ...over,
});

beforeEach(() => {
  calls = [];
  consents = [consent()];
  connected = { status: 404, body: { error: 'Not found' } };
  toast.success.mockReset();
  toast.error.mockReset();
  confirmToast.mockReset().mockResolvedValue(true);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/consents')) return { ok: true, status: 200, json: async () => ({ schemaReady: true, consents }) } as Response;
    if (url.endsWith('/connected-releases')) return { ok: connected.status === 200, status: connected.status, json: async () => connected.body } as Response;
    return { ok: true, status: 200, json: async () => ({ decision: 'no', changed: true, unlisted: true, listed: false, changed2: true }) } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Asked of you', () => {
  it('shows nothing waiting for a member who is nobody’s artist', async () => {
    consents = [];
    render(<StoreListingsView orgId="o1" showConnected={false} />);
    expect(await screen.findByTestId('store-asked-empty')).toBeTruthy();
    expect(screen.queryByTestId('store-connected')).toBeNull();
  });

  it('a no is confirmed first, then sent as exactly { decision: "no" }', async () => {
    render(<StoreListingsView orgId="o1" showConnected={false} />);
    fireEvent.click(await screen.findByTestId('store-asked-no'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/org/o1/releases/r1/consent', body: { decision: 'no' } });
  });

  it('cancelling the confirmation sends nothing', async () => {
    confirmToast.mockResolvedValue(false);
    render(<StoreListingsView orgId="o1" showConnected={false} />);
    fireEvent.click(await screen.findByTestId('store-asked-no'));
    await waitFor(() => expect(confirmToast).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('after a no only Yes is offered; after a yes only No', async () => {
    consents = [consent({ state: 'no', listed: false, decidedAt: '2026-10-02T00:00:00Z' })];
    const { unmount } = render(<StoreListingsView orgId="o1" showConnected={false} />);
    await screen.findByTestId('store-asked-row');
    expect(screen.queryByTestId('store-asked-no')).toBeNull();
    expect(screen.getByTestId('store-asked-yes')).toBeTruthy();
    expect(screen.getByTestId('store-asked-row').textContent).toMatch(/off the store, until you say yes/);
    unmount();
    consents = [consent({ state: 'yes' })];
    render(<StoreListingsView orgId="o1" showConnected={false} />);
    await screen.findByTestId('store-asked-row');
    expect(screen.queryByTestId('store-asked-yes')).toBeNull();
    expect(screen.getByTestId('store-asked-no')).toBeTruthy();
  });

  it('shows the server’s words when a refusal comes back', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/consents')) return { ok: true, status: 200, json: async () => ({ schemaReady: true, consents }) } as Response;
      return { ok: false, status: 500, json: async () => ({ error: 'Could not record your answer' }) } as Response;
    });
    render(<StoreListingsView orgId="o1" showConnected={false} />);
    fireEvent.click(await screen.findByTestId('store-asked-yes'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not record your answer'));
  });
});

describe('Releases from connected artists', () => {
  const rel = (over: Record<string, unknown> = {}) => ({
    releaseId: 'a1', title: 'Ari EP', type: 'ep', artist: 'Ari', artistOrg: 'Ari', releaseDate: '2024-01-01', listed: true, listedAt: '2026-10-01T00:00:00Z',
    playback: 'preview', vetoed: false, refused: false, serving: true, ...over,
  });

  it('is absent for anyone but the store owner: the 404 hides the section without a word', async () => {
    render(<StoreListingsView orgId="o1" showConnected />);
    await screen.findByTestId('store-asked-row');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/connected-releases'))).toBe(true));
    expect(screen.queryByTestId('store-connected')).toBeNull();
  });

  it('lists what is on the store and Unlist sends { listed: false } after a confirmation', async () => {
    connected = { status: 200, body: { schemaReady: true, releases: [rel()] } };
    render(<StoreListingsView orgId="o1" showConnected />);
    fireEvent.click(await screen.findByTestId('store-connected-unlist'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/org/o1/connected-releases/a1', body: { listed: false } });
  });

  it('a vetoed release offers Allow again, and says an artist’s no when that is why it is off', async () => {
    connected = { status: 200, body: { schemaReady: true, releases: [rel({ vetoed: true, serving: false }), rel({ releaseId: 'a2', title: 'Other', refused: true, serving: false })] } };
    render(<StoreListingsView orgId="o1" showConnected />);
    fireEvent.click(await screen.findByTestId('store-connected-allow'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: true }));
    expect(screen.getAllByTestId('store-connected-row')[1].textContent).toMatch(/an artist said no/);
  });

  it('without migration 186 the list reads and Unlist is disabled with the reason on the page', async () => {
    connected = { status: 200, body: { schemaReady: false, releases: [rel()] } };
    render(<StoreListingsView orgId="o1" showConnected />);
    const btn = (await screen.findByTestId('store-connected-unlist')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('store-connected-not-ready')).toBeTruthy();
  });
});
