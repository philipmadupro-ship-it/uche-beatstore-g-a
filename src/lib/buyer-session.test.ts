import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBuyerIdentity,
  clearBuyerToken,
  fetchBuyerFavoriteIds,
  logPlay,
  setBuyerToken,
  setFavorite,
  setPersistentBuyerSession,
} from './buyer-session';

const storage: Record<string, string> = {};

beforeEach(() => {
  vi.restoreAllMocks();
  Object.keys(storage).forEach((key) => delete storage[key]);
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
    },
    writable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    writable: true,
  });
});

describe('buyer session dispatch', () => {
  it('does nothing when there is no token or persistent account marker', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await logPlay('11111111-1111-4111-8111-111111111111');

    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the signed token endpoint when a buyer token exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setBuyerToken('signed-token');

    const result = await logPlay('11111111-1111-4111-8111-111111111111');

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/store/me?token=signed-token', expect.objectContaining({ method: 'POST' }));
  });

  it('uses the persistent session endpoint when the account marker exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setPersistentBuyerSession(true);

    const result = await logPlay('11111111-1111-4111-8111-111111111111');

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/store/me?session=1', expect.objectContaining({ method: 'POST' }));
  });

  it('clears stale session markers after an invalid session response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 }));
    setPersistentBuyerSession(true);

    const result = await logPlay('11111111-1111-4111-8111-111111111111');

    expect(result.ok).toBe(false);
    clearBuyerToken();
    expect(storage['antigravity-buyer-session-mode']).toBeUndefined();
  });

  it('prefers the signed-in account over a legacy delivery token for another email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setBuyerToken('token-for-some-other-address');
    setPersistentBuyerSession(true);

    await logPlay('11111111-1111-4111-8111-111111111111');

    expect(fetch).toHaveBeenCalledWith('/api/store/me?session=1', expect.anything());
  });

  it('sends the heart state, not a toggle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setPersistentBuyerSession(true);

    await setFavorite('11111111-1111-4111-8111-111111111111', true);

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'set_favorite',
      track_id: '11111111-1111-4111-8111-111111111111',
      favorited: true,
    });
  });

  it('clearBuyerIdentity forgets both the token and the account marker', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    setBuyerToken('t');
    setPersistentBuyerSession(true);
    clearBuyerIdentity();

    expect((await logPlay('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchBuyerFavoriteIds', () => {
  it('returns null (unknown), not [], when there is no buyer identity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchBuyerFavoriteIds()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the account favourite ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      email: 'b@x.test', history: [], playlists: [],
      favorites: [{ track_id: 'a', created_at: '' }, { track_id: 'b', created_at: '' }],
    }), { status: 200 }));
    setPersistentBuyerSession(true);

    expect(await fetchBuyerFavoriteIds()).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledWith('/api/store/me?session=1');
  });

  it('returns null on a server error so the caller does not wipe local hearts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    setPersistentBuyerSession(true);
    expect(await fetchBuyerFavoriteIds()).toBeNull();
  });

  it('drops an expired session marker on 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 400 }));
    setPersistentBuyerSession(true);
    expect(await fetchBuyerFavoriteIds()).toBeNull();
    expect(storage['antigravity-buyer-session-mode']).toBeUndefined();
  });
});

describe('buyer session precedence', () => {
  it('prefers the persistent account over a leftover legacy token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    // Buyer opened a 24h delivery link, then signed in. The link token is
    // still in localStorage long after it expired.
    setBuyerToken('expired-legacy-token');
    setPersistentBuyerSession(true);

    const result = await logPlay('11111111-1111-4111-8111-111111111111');

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/store/me?session=1', expect.objectContaining({ method: 'POST' }));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('token='), expect.anything());
  });

  it('a rejected session clears only the session marker and falls back to the token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setBuyerToken('live-token');
    setPersistentBuyerSession(true);

    expect((await logPlay('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(storage['antigravity-buyer-session-mode']).toBeUndefined();
    expect(storage['antigravity-buyer-token']).toBe('live-token');

    expect((await logPlay('11111111-1111-4111-8111-111111111111')).ok).toBe(true);
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/store/me?token=live-token', expect.objectContaining({ method: 'POST' }));
  });
});
