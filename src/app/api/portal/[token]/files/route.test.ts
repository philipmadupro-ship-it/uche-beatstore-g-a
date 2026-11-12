/**
 * POST /api/portal/[token]/files and ./presign — a contact's own upload
 * (PORTAL-UP). The gate is the real membership rule over a mocked database:
 * outside the portal 404, uploads off 403, the producer's file rules, the
 * private bucket, the row credited to the contact, no storage reference out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = 'owner-0000';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const stored: string[] = [];
const deleted: string[] = [];
let existingObjectSize: number | null = 1234;

const db = {
  project_contacts: [
    { project_id: P1, contact_id: 'c1', user_id: OWNER, in_portal: true, can_upload: true, created_at: '2026-09-01', last_notified_at: null, allow_downloads: false, can_comment: true, role: 'artist' },
    { project_id: P2, contact_id: 'c1', user_id: OWNER, in_portal: true, can_upload: false, created_at: '2026-09-01', last_notified_at: null, allow_downloads: false, can_comment: true, role: 'artist' },
  ],
  projects: [{ id: P1, name: 'EP', status: 'in_progress', user_id: OWNER }, { id: P2, name: 'Other', status: 'in_progress', user_id: OWNER }],
  contacts: [{ id: 'c1', name: 'Nova', user_id: OWNER }],
  project_assets: [] as Array<Record<string, unknown>>,
} as Record<string, Array<Record<string, unknown>>>;

function chain(table: string) {
  const filters: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {};
  let pending: Record<string, unknown> | null = null;
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
  q.select = () => q;
  q.order = () => q;
  q.limit = () => q;
  q.eq = (k: string, v: unknown) => { filters.push([k, v]); return q; };
  q.in = (k: string, v: unknown[]) => { filters.push([k, v]); return q; };
  q.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); pending = { id: `asset-${inserts.length}`, ...row }; return q; };
  q.single = () => Promise.resolve({ data: pending, error: null });
  q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: pending ? [pending] : rows(), error: null }).then(resolve);
  return q;
}

vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({ from: (t: string) => chain(t) }) }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: () => Promise.resolve(true), clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/artist-portal/gate', () => ({
  gatePortal: (_a: unknown, token: string) => Promise.resolve(token === 'good-token-1234567890'
    ? { ok: true, portal: { id: 'portal-1', token, user_id: OWNER, contact_id: 'c1', last_viewed_at: null, previous_viewed_at: null, view_count: 0 } }
    : { ok: false, res: new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }) }),
}));
vi.mock('@/lib/storage/project-assets', () => ({
  projectAssetBuckets: () => ['private-bucket'],
  storeProjectAsset: (_b: Buffer, key: string) => { stored.push(key); return Promise.resolve(`r2://private-bucket/${key}`); },
  privateProjectAssetRef: (key: string) => `r2://private-bucket/${key}`,
  projectAssetSize: () => Promise.resolve(existingObjectSize),
  deleteProjectAssetObject: (ref: string) => { deleted.push(ref); return Promise.resolve(); },
  presignProjectAssetPut: (key: string) => Promise.resolve({ uploadUrl: `https://r2.test/put/${key}?sig=x`, url: `r2://private-bucket/${key}` }),
}));

const params = (token = 'good-token-1234567890') => ({ params: Promise.resolve({ token }) });

function multipart(projectId: string, name = 'verse idea.wav', size = 10) {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(size)], name));
  form.set('project_id', projectId);
  return new NextRequest('http://localhost/api/portal/x/files', { method: 'POST', body: form });
}
function json(body: unknown, path = 'files') {
  return new NextRequest(`http://localhost/api/portal/x/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserts.length = 0;
  stored.length = 0;
  deleted.length = 0;
  db.project_assets = [];
  existingObjectSize = 1234;
});

describe('POST /api/portal/[token]/files', () => {
  it('stores a contact’s file in the private bucket, credited to them, in the portal', async () => {
    const { POST } = await import('./route');
    const res = await POST(multipart(P1), params());
    expect(res.status).toBe(201);
    const asset = inserts.find((i) => i.table === 'project_assets')!.row;
    expect(asset).toMatchObject({
      user_id: OWNER, project_id: P1, uploaded_by_contact_id: 'c1', in_portal: true, kind: 'audio', label: 'verse idea', mime: 'audio/wav',
    });
    expect(String(asset.url)).toMatch(new RegExp(`^r2://private-bucket/project-assets/${P1}/[A-Za-z0-9_-]{16}\\.wav$`));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('r2://');
    expect(body.file).toMatchObject({ projectId: P1, fromYou: true, isNew: false });
    expect(inserts.some((i) => i.table === 'notifications' && i.row.kind === 'portal_upload')).toBe(true);
    expect(inserts.some((i) => i.table === 'contact_activity' && i.row.kind === 'file_uploaded')).toBe(true);
  });

  it('answers 404 for a project outside the portal and stores nothing', async () => {
    const { POST } = await import('./route');
    expect((await POST(multipart(P3), params())).status).toBe(404);
    expect(stored).toEqual([]);
  });

  it('answers 403 when the producer has not switched uploads on', async () => {
    const { POST } = await import('./route');
    expect((await POST(multipart(P2), params())).status).toBe(403);
    expect(stored).toEqual([]);
  });

  it('answers the gate’s own refusal for a bad token', async () => {
    const { POST } = await import('./route');
    expect((await POST(multipart(P1), params('bad-token-000000000'))).status).toBe(404);
  });

  it('refuses .html and .svg (served back from our origin they are scripts)', async () => {
    const { POST } = await import('./route');
    expect((await POST(multipart(P1, 'page.html'), params())).status).toBe(415);
    expect((await POST(multipart(P1, 'logo.svg'), params())).status).toBe(415);
    expect(stored).toEqual([]);
  });

  it('registers a presigned upload by its opaque id, rebuilding the reference itself', async () => {
    const { POST } = await import('./route');
    const res = await POST(json({ project_id: P1, upload_id: 'abcdefghijklmnop.wav', file_name: 'take 3.wav' }), params());
    expect(res.status).toBe(201);
    expect(inserts.find((i) => i.table === 'project_assets')!.row.url).toBe(`r2://private-bucket/project-assets/${P1}/abcdefghijklmnop.wav`);
  });

  it('never accepts a storage reference from the client', async () => {
    const { POST } = await import('./route');
    const res = await POST(json({ project_id: P1, url: `r2://private-bucket/project-assets/${P1}/abcdefghijklmnop.wav`, file_name: 'x.wav' }), params());
    expect(res.status).toBe(400);
    const bad = await POST(json({ project_id: P1, upload_id: '../../masters/t1.wav', file_name: 'x.wav' }), params());
    expect(bad.status).toBe(400);
  });

  it('refuses to register an object twice (an existing file of the project)', async () => {
    db.project_assets = [{ id: 'old', url: `r2://private-bucket/project-assets/${P1}/abcdefghijklmnop.pdf`, project_id: P1 }];
    const { POST } = await import('./route');
    const res = await POST(json({ project_id: P1, upload_id: 'abcdefghijklmnop.pdf', file_name: 'contract.pdf' }), params());
    expect(res.status).toBe(409);
    expect(deleted).toEqual([]);
  });

  it('says so when the presigned upload never arrived', async () => {
    existingObjectSize = null;
    const { POST } = await import('./route');
    expect((await POST(json({ project_id: P1, upload_id: 'abcdefghijklmnop.wav', file_name: 'x.wav' }), params())).status).toBe(409);
  });
});

describe('POST /api/portal/[token]/files/presign', () => {
  it('returns a PUT URL and an opaque id, never the stored reference', async () => {
    const { POST } = await import('./presign/route');
    const res = await POST(json({ project_id: P1, file_name: 'big mix.wav', size_bytes: 50 * 1024 * 1024 }, 'files/presign'), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadId).toMatch(/^[A-Za-z0-9_-]{16}\.wav$/);
    expect(body.contentType).toBe('audio/wav');
    expect(JSON.stringify(body)).not.toContain('r2://');
  });

  it('has the same membership rule', async () => {
    const { POST } = await import('./presign/route');
    expect((await POST(json({ project_id: P2, file_name: 'a.wav', size_bytes: 10 }, 'files/presign'), params())).status).toBe(403);
    expect((await POST(json({ project_id: P3, file_name: 'a.wav', size_bytes: 10 }, 'files/presign'), params())).status).toBe(404);
  });
});
