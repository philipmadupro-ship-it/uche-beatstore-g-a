import { describe, expect, it, vi } from 'vitest';
import { resolveStudioAsset } from './studio-resolve';

const P = '40000000-0000-4000-8000-0000000000a1';
const F = '60000000-0000-4000-8000-000000000001';
const D = '60000000-0000-4000-8000-000000000002';
const T = '70000000-0000-4000-8000-000000000001';

type Route = (url: string) => { status?: number; body?: unknown } | 'throw';
function fakeFetch(route: Route) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = route(url);
    if (r === 'throw') throw new TypeError('network down');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id, project_id: P, kind: 'audio', label: 'Vocal reference', file_name: 'ref.wav', mime: 'audio/wav', size_bytes: 1000, position: 0,
  in_portal: false, portal_at: null, created_at: 'x', downloadUrl: `/api/projects/${P}/assets/${id}/download`, ...over,
});

describe('project file', () => {
  const route: Route = (url) => {
    if (url === `/api/projects/${P}/assets`) return { body: { assets: [asset(F), asset(D, { kind: 'document', file_name: 'a.pdf', mime: 'application/pdf' })] } };
    if (url === `/api/projects/${P}`) return { body: { project: { name: 'Night Drive EP' } } };
    return { status: 404 };
  };
  it('resolves through the owner-gated list and names the project', async () => {
    const { f, calls } = fakeFetch(route);
    const r = await resolveStudioAsset(`project:${P}:file:${F}`, { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, source: { kind: 'project_file', title: 'Vocal reference', from: 'Night Drive EP', src: `/api/projects/${P}/assets/${F}/download`, offlineOnly: false } });
    expect(calls).toEqual([`/api/projects/${P}/assets`, `/api/projects/${P}`]);
  });
  it('a file that is not in the list is not_found; a document is not_audio', async () => {
    const { f } = fakeFetch(route);
    expect(await resolveStudioAsset(`project:${P}:file:60000000-0000-4000-8000-0000000000ff`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await resolveStudioAsset(`project:${P}:file:${D}`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_audio' });
  });
  it("another owner's project (404 from the owner gate) is not_found", async () => {
    const { f } = fakeFetch(() => ({ status: 404 }));
    expect(await resolveStudioAsset(`project:${P}:file:${F}`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_found' });
  });
  it('with the network down it opens this device’s saved copy, and says so', async () => {
    const { f } = fakeFetch(() => 'throw');
    const readSaved = vi.fn(async () => ({ title: 'Vocal reference', size: 3_000_000 }));
    const r = await resolveStudioAsset(`project:${P}:file:${F}`, { fetchImpl: f, readSaved });
    expect(readSaved).toHaveBeenCalledWith(`project:${P}:file:${F}`);
    expect(r).toMatchObject({ ok: true, source: { offlineOnly: true, title: 'Vocal reference', cacheId: `project:${P}:file:${F}`, contentKey: undefined, src: `/api/projects/${P}/assets/${F}/download` } });
  });
  it('with the network down and nothing saved it is unavailable, never a blank result', async () => {
    const { f } = fakeFetch(() => 'throw');
    expect(await resolveStudioAsset(`project:${P}:file:${F}`, { fetchImpl: f, readSaved: async () => null })).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});

describe('track WAV and stems', () => {
  const route: Route = (url) => {
    if (url === `/api/tracks/${T}`) return { body: { id: T, title: 'Night Shift', audio_url: 'r2://priv/t.mp3', wav_url: 'r2://priv/t.wav' } };
    if (url === `/api/stems?track_id=${T}`) return { body: { stem: { vocals_url: 'r2://raw/never-used' }, job: { status: 'ready', stems: { vocals: '/api/audio?src=r2%3A%2F%2Fpriv%2Fv.wav', drums: null, bass: null, other: null } } } };
    return { status: 404 };
  };
  it('a WAV resolves through the track read', async () => {
    const { f } = fakeFetch(route);
    const r = await resolveStudioAsset(`track:${T}:wav`, { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, source: { kind: 'wav', title: 'Night Shift — WAV', from: 'Night Shift', cacheId: `track:${T}:wav` } });
  });
  it('a stem resolves from the job view (proxy URLs), not the raw row', async () => {
    const { f } = fakeFetch(route);
    const r = await resolveStudioAsset(`track:${T}:stem:vocals`, { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, source: { kind: 'stem', src: '/api/audio?src=r2%3A%2F%2Fpriv%2Fv.wav' } });
    expect(JSON.stringify(r)).not.toContain('never-used');
  });
  it('a stem that does not exist, or a job that is not ready, is not_found', async () => {
    const { f } = fakeFetch(route);
    expect(await resolveStudioAsset(`track:${T}:stem:drums`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_found' });
    const notReady = fakeFetch((u) => (u.startsWith('/api/stems') ? { body: { job: { status: 'processing', stems: null } } } : route(u)));
    expect(await resolveStudioAsset(`track:${T}:stem:vocals`, { fetchImpl: notReady.f })).toMatchObject({ ok: false, reason: 'not_found' });
  });
  it('a track with no WAV has no WAV asset', async () => {
    const { f } = fakeFetch((u) => (u === `/api/tracks/${T}` ? { body: { id: T, title: 'N', audio_url: 'r2://priv/t.mp3', wav_url: null } } : { status: 404 }));
    expect(await resolveStudioAsset(`track:${T}:wav`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_found' });
  });
  it("another owner's track (404) is not_found", async () => {
    const { f } = fakeFetch(() => ({ status: 404 }));
    expect(await resolveStudioAsset(`track:${T}:wav`, { fetchImpl: f })).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('invalid ids never reach the network', () => {
  it('malformed, uppercase and traversal ids make no request', async () => {
    const { f, calls } = fakeFetch(() => ({ body: {} }));
    for (const id of ['', 'nope', `project:ABCDEF00-AAAA-4BBB-8CCC-DDDDEEEEFFFF:file:${F}`, `track:${T}/../x:wav`, `track:${T}:stem:drum`]) {
      expect(await resolveStudioAsset(id, { fetchImpl: f }), id).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(calls).toEqual([]);
  });
  it('output never contains a stored reference', async () => {
    const { f } = fakeFetch((u) => (u === `/api/tracks/${T}` ? { body: { id: T, title: 'N', audio_url: 'r2://priv/a.mp3', wav_url: 'local://x/y.wav' } } : { status: 404 }));
    const r = await resolveStudioAsset(`track:${T}:wav`, { fetchImpl: f });
    expect(JSON.stringify(r)).not.toMatch(/r2:\/\/|local:\/\//);
  });
});
