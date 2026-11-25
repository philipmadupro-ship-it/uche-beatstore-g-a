/**
 * AUDIO-02: DAW project files through the REAL producer assets routes (upload,
 * register after a presigned PUT, and the metadata read). Ownership, the
 * database and storage are faked; the validation, signature check, portal
 * default and response shaping are the real code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { alsFixture, flpFixture, rppFixture, zipFixture } from '@/lib/projects/mocks/daw-fixtures';

const PID = '40000000-0000-4000-8000-0000000000a1';
const OWNER = 'owner-1';

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  stored: [] as Array<{ key: string; mime: string; bytes: number }>,
  deleted: [] as string[],
  heads: new Map<string, Uint8Array>(),
  sizes: new Map<string, number>(),
  row: null as null | { url: string; file_name: string },
  filters: [] as Array<[string, unknown]>,
  denied: false,
}));

vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
vi.mock('@/lib/auth/ownership', () => ({
  requireRowOwnership: async () => {
    if (state.denied) return { ok: false, res: new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }) };
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      order: chain,
      eq: (col: string, val: unknown) => { state.filters.push([col, val]); return q; },
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: state.row, error: null }),
      insert: (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'new-1', created_at: 'now', updated_at: 'now', ...row }, error: null }) }) };
      },
    });
    return { ok: true, userId: OWNER, admin: { from: () => q } };
  },
}));
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['priv'],
  storeProjectAsset: async (buffer: Buffer, key: string, mime: string) => {
    state.stored.push({ key, mime, bytes: buffer.length });
    return `r2://priv/${key}`;
  },
  projectAssetSize: async (r: string) => state.sizes.get(r) ?? null,
  deleteProjectAssetObject: async (r: string) => { state.deleted.push(r); },
  readProjectAssetHead: async (r: string, n: number) => {
    const h = state.heads.get(r);
    return h ? h.subarray(0, n) : null;
  },
}));

import { POST } from './route';
import { GET as META } from './[assetId]/meta/route';

const params = Promise.resolve({ id: PID });
const upload = (name: string, bytes: Uint8Array, fields: Record<string, string> = {}) => {
  const form = new FormData();
  form.append('file', new File([bytes as BlobPart], name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(new NextRequest('http://x/api/projects/p/assets', { method: 'POST', body: form }), { params });
};
const register = (url: string, file_name: string, extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('http://x/api/projects/p/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, file_name, ...extra }) }),
    { params },
  );

beforeEach(() => {
  state.inserted.length = 0;
  state.stored.length = 0;
  state.deleted.length = 0;
  state.heads.clear();
  state.sizes.clear();
  state.filters.length = 0;
  state.row = null;
  state.denied = false;
});

describe('upload (through the app)', () => {
  it('stores an FLP in the private area as an opaque octet-stream and keeps it out of the portal', async () => {
    const res = await upload('Night Shift.flp', flpFixture({ version: '21.2.3.3586', bpm: 140 }), { in_portal: 'true' });
    expect(res.status).toBe(201);
    expect(state.stored).toHaveLength(1);
    expect(state.stored[0].mime).toBe('application/octet-stream');
    expect(state.stored[0].key).toMatch(new RegExp(`^project-assets/${PID}/[A-Za-z0-9_-]+\\.flp$`));
    expect(state.inserted[0]).toMatchObject({ kind: 'other', mime: 'application/octet-stream', file_name: 'Night Shift.flp', in_portal: false, portal_at: null, user_id: OWNER });
    const body = await res.json() as { asset: Record<string, unknown> };
    expect(JSON.stringify(body)).not.toMatch(/r2:\/\/|"url"/);
    expect(body.asset.downloadUrl).toBe(`/api/projects/${PID}/assets/new-1/download`);
  });

  it('keeps ordinary files as the producer asked (an audio file can still go to the portal)', async () => {
    const wav = new Uint8Array(Buffer.from('RIFF....WAVE'));
    const res = await upload('ref.wav', wav, { in_portal: 'true' });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ in_portal: true });
  });

  it('refuses a renamed file: nothing is stored or inserted', async () => {
    for (const [name, bytes] of [
      ['fake.flp', new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>'))],
      ['fake.als', flpFixture()],
      ['fake.rpp', alsFixture()],
    ] as const) {
      const res = await upload(name, bytes);
      expect(res.status, name).toBe(415);
    }
    expect(state.stored).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });

  it('accepts a real Ableton set and a Reaper project; Pro Tools / Cubase are by extension', async () => {
    expect((await upload('a.als', alsFixture())).status).toBe(201);
    expect((await upload('r.rpp', rppFixture())).status).toBe(201);
    expect((await upload('p.ptx', new Uint8Array(8).fill(1))).status).toBe(201);
    expect(state.inserted.every((r) => r.in_portal === false)).toBe(true);
  });

  it('still refuses a script type', async () => {
    expect((await upload('x.html', new Uint8Array(Buffer.from('<script>')))).status).toBe(415);
  });

  it('a zipped session never defaults into the portal, a plain zip does', async () => {
    expect((await upload('bundle.zip', zipFixture('Night Shift/Night Shift.flp'), { in_portal: 'true' })).status).toBe(201);
    expect((await upload('photos.zip', zipFixture('photos/cover.png'), { in_portal: 'true' })).status).toBe(201);
    expect(state.inserted.map((r) => r.in_portal)).toEqual([false, true]);
  });
});

describe('register after a presigned upload', () => {
  const ref = (id: string, ext: string) => `r2://priv/project-assets/${PID}/${id}.${ext}`;

  it('a mismatching object is refused AND deleted from storage', async () => {
    const url = ref('abcdef1234', 'flp');
    state.sizes.set(url, 5000);
    state.heads.set(url, new Uint8Array(Buffer.from('this is not an fl studio project')));
    const res = await register(url, 'Big Session.flp');
    expect(res.status).toBe(415);
    expect(state.deleted).toEqual([url]);
    expect(state.inserted).toHaveLength(0);
  });

  it('an object whose head cannot be read is refused and deleted too', async () => {
    const url = ref('abcdef1235', 'als');
    state.sizes.set(url, 5000);
    const res = await register(url, 'Set.als');
    expect(res.status).toBe(415);
    expect(state.deleted).toEqual([url]);
  });

  it('a genuine file registers, off the portal even when asked', async () => {
    const url = ref('abcdef1236', 'flp');
    state.sizes.set(url, 5_000_000);
    state.heads.set(url, flpFixture({ version: '21.0.0.1' }));
    const res = await register(url, 'Big Session.flp', { in_portal: true });
    expect(res.status).toBe(201);
    expect(state.deleted).toHaveLength(0);
    expect(state.inserted[0]).toMatchObject({ in_portal: false, mime: 'application/octet-stream', size_bytes: 5_000_000 });
  });

  it('a zipped session registered this way is also kept out of the portal', async () => {
    const url = ref('abcdef1237', 'zip');
    state.sizes.set(url, 9_000_000);
    state.heads.set(url, zipFixture('Song.logicx/Alternatives/000/ProjectData'));
    expect((await register(url, 'Song.zip', { in_portal: true })).status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ in_portal: false });
  });

  it("another project's key is still refused before anything is read", async () => {
    const url = 'r2://priv/project-assets/50000000-0000-4000-8000-000000000009/abcdef1238.flp';
    state.sizes.set(url, 10);
    const res = await register(url, 'x.flp');
    expect(res.status).toBe(400);
    expect(state.deleted).toHaveLength(0);
  });
});

describe('GET …/meta', () => {
  const call = () => META(new NextRequest('http://x'), { params: Promise.resolve({ id: PID, assetId: 'a1' }) });

  it('returns exactly app, appVersion and bpm, private and no-store, owner-filtered', async () => {
    state.row = { url: 'r2://priv/project-assets/x/k.flp', file_name: 'Night Shift.flp' };
    state.heads.set(state.row.url, flpFixture({ version: '21.2.3.3586', bpm: 140 }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ app: 'FL Studio', appVersion: '21.2.3.3586', bpm: 140 });
    expect(state.filters).toEqual(expect.arrayContaining([['user_id', OWNER], ['project_id', PID], ['id', 'a1']]));
  });

  it('an Ableton set never leaks names or paths from inside it', async () => {
    state.row = { url: 'r2://priv/project-assets/x/k.als', file_name: 'Set.als' };
    state.heads.set(state.row.url, alsFixture({ bpm: 90 }));
    const text = JSON.stringify(await (await call()).json());
    expect(text).toBe('{"app":"Ableton Live","appVersion":"11.0.12","bpm":90}');
  });

  it('a bundled session names its app only', async () => {
    state.row = { url: 'r2://priv/project-assets/x/k.zip', file_name: 'Bundle.zip' };
    state.heads.set(state.row.url, zipFixture('Night Shift/Night Shift.flp'));
    expect(await (await call()).json()).toEqual({ app: 'FL Studio', appVersion: null, bpm: null });
  });

  it('is 404 (no-store) for a non-DAW file, a plain zip, an unreadable object, a missing or foreign row', async () => {
    state.row = { url: 'r2://priv/project-assets/x/k.pdf', file_name: 'a.pdf' };
    expect((await call()).status).toBe(404);
    state.row = { url: 'r2://priv/project-assets/x/k.zip', file_name: 'photos.zip' };
    state.heads.set(state.row.url, zipFixture('photos/a.png'));
    expect((await call()).status).toBe(404);
    state.row = { url: 'r2://priv/project-assets/x/gone.flp', file_name: 'a.flp' };
    const gone = await call();
    expect(gone.status).toBe(404);
    expect(gone.headers.get('cache-control')).toBe('private, no-store');
    state.row = null;
    expect((await call()).status).toBe(404);
    state.denied = true;
    expect((await call()).status).toBe(404);
  });
});
