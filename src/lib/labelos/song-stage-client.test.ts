import { afterEach, describe, expect, it, vi } from 'vitest';
import { postSongStage } from './song-stage-client';

const stub = (res: Response | Error) => vi.stubGlobal('fetch', vi.fn(async () => { if (res instanceof Error) throw res; return res; }));
afterEach(() => vi.unstubAllGlobals());

describe('postSongStage', () => {
  it('posts { to, from } to the stage route', async () => {
    stub(new Response(JSON.stringify({ to: 'in_review' }), { status: 200 }));
    const r = await postSongStage('o1', 's1', 'in_review', 'inbox');
    expect(r).toEqual({ ok: true, stage: 'in_review' });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/org/o1/tracks/s1/stage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ to: 'in_review', from: 'inbox' });
  });
  it('carries the server\'s words on a 409', async () => {
    stub(new Response(JSON.stringify({ error: 'A song cannot move from Inbox to Selected' }), { status: 409 }));
    expect(await postSongStage('o1', 's1', 'selected', 'inbox')).toEqual({ ok: false, error: 'A song cannot move from Inbox to Selected' });
  });
  it('has words for a body that is not JSON and for a network failure', async () => {
    stub(new Response('boom', { status: 500 }));
    expect(await postSongStage('o1', 's1', 'passed', 'inbox')).toEqual({ ok: false, error: 'Could not move the song.' });
    stub(new Error('offline'));
    expect(await postSongStage('o1', 's1', 'passed', 'inbox')).toEqual({ ok: false, error: 'Could not move the song.' });
  });
});
