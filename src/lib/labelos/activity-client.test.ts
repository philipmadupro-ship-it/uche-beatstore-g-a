import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendPage, fetchActivityPage, type FeedPage } from './activity-client';

afterEach(() => vi.unstubAllGlobals());

const ev = (id: string) => ({ id, verb: 'song.created', at: '2026-10-05T10:00:00.000Z', actorId: 'a', artistId: 'c', projectId: null, songId: null, releaseId: null, subjectType: null, subjectId: id, visibility: 'artist' as const, summary: {} });
const page = (over: Partial<FeedPage> = {}): FeedPage => ({
  events: [ev('e1')], names: { actors: { a: 'Ana' }, artists: {}, releases: {} }, projectArtists: {}, restricted: 0, hasMore: false, nextBefore: null, ...over,
});
const stub = (res: Response | Error) => {
  const f = vi.fn(async (..._args: unknown[]) => { if (res instanceof Error) throw res; return res; });
  vi.stubGlobal('fetch', f);
  return f;
};

describe('fetchActivityPage', () => {
  it('asks for the feed with its own params and the cursor', async () => {
    const f = stub(new Response(JSON.stringify(page())));
    const r = await fetchActivityPage('o1', { artist: 'c1' }, '2026-10-05T10:00:00.000Z_abc');
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0][0]).toBe(`/api/org/o1/activity?limit=100&artist=c1&before=${encodeURIComponent('2026-10-05T10:00:00.000Z_abc')}`);
  });

  it('fills what an older server leaves out', async () => {
    stub(new Response(JSON.stringify({ events: [], names: { actors: {}, artists: {}, releases: {} } })));
    const r = await fetchActivityPage('o1', {}, null);
    expect(r).toEqual({ ok: true, page: { events: [], names: { actors: {}, artists: {}, releases: {} }, projectArtists: {}, restricted: 0, hasMore: false, nextBefore: null } });
  });

  it('reports the server’s message, a neutral one for a bad body, and one for a network failure', async () => {
    stub(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
    expect(await fetchActivityPage('o1', {}, null)).toEqual({ ok: false, error: 'Forbidden' });
    stub(new Response('not json', { status: 200 }));
    expect(await fetchActivityPage('o1', {}, null)).toEqual({ ok: false, error: 'Could not load the activity.' });
    stub(new Error('offline'));
    expect(await fetchActivityPage('o1', {}, null)).toEqual({ ok: false, error: 'Could not load the activity.' });
  });
});

describe('appendPage', () => {
  it('appends the older page, once per event id, and merges names', () => {
    const a = page({ events: [ev('e2'), ev('e1')], hasMore: true, nextBefore: 'x', restricted: 1 });
    const b = page({ events: [ev('e1'), ev('e0')], names: { actors: { b: 'Ben' }, artists: { c: 'Nova' }, releases: {} }, projectArtists: { p: ['c'] }, restricted: 2, hasMore: false, nextBefore: null });
    const m = appendPage(a, b);
    expect(m.events.map((e) => e.id)).toEqual(['e2', 'e1', 'e0']);
    expect(m.names).toEqual({ actors: { a: 'Ana', b: 'Ben' }, artists: { c: 'Nova' }, releases: {} });
    expect(m.projectArtists).toEqual({ p: ['c'] });
    expect([m.restricted, m.hasMore, m.nextBefore]).toEqual([3, false, null]);
  });
});
