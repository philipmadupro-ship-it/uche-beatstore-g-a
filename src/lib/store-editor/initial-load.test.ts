import { describe, expect, it } from 'vitest';
import {
  failedSourceLabels,
  loadSource,
  loadStoreEditor,
  saveScope,
  STORE_EDITOR_SOURCES,
} from './initial-load';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

const healthy: Record<string, () => Response> = {
  [STORE_EDITOR_SOURCES.profile]: () => jsonResponse({ profile: { display_name: 'Uche', bio: 'Saved bio' } }),
  [STORE_EDITOR_SOURCES.playlists]: () => jsonResponse({ playlists: [] }),
  [STORE_EDITOR_SOURCES.summary]: () => jsonResponse({ producerPicks: [] }),
  [STORE_EDITOR_SOURCES.projects]: () => jsonResponse({ projects: [] }),
  [STORE_EDITOR_SOURCES.promoCodes]: () => jsonResponse({ codes: [] }),
  [STORE_EDITOR_SOURCES.licenses]: () => jsonResponse({ licenses: [] }),
};

function fakeFetch(overrides: Record<string, () => Response | Promise<Response>> = {}): typeof fetch {
  const routes = { ...healthy, ...overrides };
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected ${url}`);
    return handler();
  }) as typeof fetch;
}

describe('loadSource', () => {
  it('returns the parsed body for a 2xx JSON object', async () => {
    const r = await loadSource('/x', (async () => jsonResponse({ a: 1 })) as typeof fetch);
    expect(r).toEqual({ ok: true, data: { a: 1 } });
  });

  it('fails on a 2xx body that is not JSON', async () => {
    const r = await loadSource('/x', (async () => textResponse('<html>')) as typeof fetch);
    expect(r).toEqual({ ok: false, status: 200, error: 'Response was not JSON' });
  });

  it('fails on a non-2xx and keeps the server message', async () => {
    const r = await loadSource('/x', (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch);
    expect(r).toEqual({ ok: false, status: 500, error: 'boom' });
  });

  it('fails on a non-2xx HTML page', async () => {
    const r = await loadSource('/x', (async () => textResponse('Bad gateway', 502)) as typeof fetch);
    expect(r).toEqual({ ok: false, status: 502, error: 'HTTP 502' });
  });

  it('fails on a network error without throwing', async () => {
    const r = await loadSource('/x', (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
    expect(r).toEqual({ ok: false, status: null, error: 'Failed to fetch' });
  });

  it('fails on a JSON array or null', async () => {
    expect((await loadSource('/x', (async () => jsonResponse([])) as typeof fetch)).ok).toBe(false);
    expect((await loadSource('/x', (async () => jsonResponse(null)) as typeof fetch)).ok).toBe(false);
  });
});

describe('loadStoreEditor', () => {
  it('loads every source independently', async () => {
    const load = await loadStoreEditor(fakeFetch());
    expect(Object.values(load).every((r) => r.ok)).toBe(true);
    expect(saveScope(load)).toEqual({ profile: true, playlists: true, projects: true });
    expect(failedSourceLabels(load)).toEqual([]);
  });

  it('still delivers the profile when promo codes and licenses return non-JSON', async () => {
    // The production failure: these two broke the old Promise.all, the profile
    // never reached the form, and Save wrote empty defaults over it.
    const load = await loadStoreEditor(fakeFetch({
      [STORE_EDITOR_SOURCES.promoCodes]: () => textResponse('Internal Server Error', 500),
      [STORE_EDITOR_SOURCES.licenses]: () => textResponse(''),
    }));
    expect(load.profile).toEqual({ ok: true, data: { profile: { display_name: 'Uche', bio: 'Saved bio' } } });
    expect(saveScope(load).profile).toBe(true);
    expect(failedSourceLabels(load)).toEqual(['promo codes', 'license tiers']);
  });

  it('forbids the profile write when the profile did not load', async () => {
    const load = await loadStoreEditor(fakeFetch({
      [STORE_EDITOR_SOURCES.profile]: () => textResponse('<html>oops</html>', 500),
    }));
    expect(saveScope(load)).toEqual({ profile: false, playlists: true, projects: true });
    expect(failedSourceLabels(load)).toEqual(['profile']);
  });

  it('forbids featured writes for a list that did not load', async () => {
    // Un-featuring is computed as "featured before, not in the list now"; from
    // an empty list that silently computes nothing, but a half-loaded one
    // could un-feature real rows. Better to not write at all.
    const load = await loadStoreEditor(fakeFetch({
      [STORE_EDITOR_SOURCES.playlists]: () => jsonResponse({ error: 'nope' }, 500),
      [STORE_EDITOR_SOURCES.projects]: () => jsonResponse({ unexpected: true }),
    }));
    expect(saveScope(load)).toEqual({ profile: true, playlists: false, projects: false });
  });

  it('survives a network failure on one source', async () => {
    const load = await loadStoreEditor(fakeFetch({
      [STORE_EDITOR_SOURCES.summary]: () => { throw new TypeError('Failed to fetch'); },
    }));
    expect(load.summary.ok).toBe(false);
    expect(load.profile.ok).toBe(true);
  });
});
