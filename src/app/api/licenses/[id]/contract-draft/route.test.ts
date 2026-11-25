/**
 * LICENSE-05: GET/POST /api/licenses/[id]/contract-draft.
 *
 * A real in-memory table fake behind the mocked ownership module, so the tests
 * create a license through the REAL POST /api/licenses handler and then read
 * its contract draft, and so ownership is the same `user_id` filter the routes
 * use. Nothing here touches a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string }>,
  user: 'user-a' as string | null,
  seq: 0,
}));

function chain(table: string) {
  let rows = db.tables[table] ?? [];
  let op = 'select';
  let inserted: Row | null = null;
  const c: Record<string, unknown> = {
    select: () => c,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return c; },
    order: () => c,
    limit: (n: number) => { rows = rows.slice(0, n); return c; },
    insert: (row: Row) => {
      op = 'insert';
      db.writes.push({ table, op });
      inserted = { id: `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`, ...row };
      (db.tables[table] ??= []).push(inserted);
      return c;
    },
    update: () => { db.writes.push({ table, op: 'update' }); return c; },
    upsert: () => { db.writes.push({ table, op: 'upsert' }); return c; },
    delete: () => { db.writes.push({ table, op: 'delete' }); return c; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: inserted ?? rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return c;
}
const admin = { from: (t: string) => chain(t) };

vi.mock('@/lib/auth/ownership', () => ({
  requireUser: async () => db.user
    ? { ok: true, userId: db.user, admin }
    : { ok: false, res: new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'content-type': 'application/json' } }) },
  createServiceClient: () => admin,
}));
const rate = vi.hoisted(() => ({ allow: true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => rate.allow }));

import { POST as createLicense } from '../../route';
import { GET, POST } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const U = 'http://localhost/api/licenses/x/contract-draft';

async function createTier(user: string, body: Record<string, unknown>) {
  db.user = user;
  const res = await createLicense(jsonReq('http://localhost/api/licenses', body));
  expect(res.status).toBe(201);
  return (await res.json()).license as Row;
}

beforeEach(() => {
  db.tables = {
    licenses: [],
    creator_profiles: [
      { user_id: 'user-a', display_name: 'Producer A', contact_email: 'a@example.test', license_template_md: '' },
      { user_id: 'user-b', display_name: 'Producer B', contact_email: 'b@example.test', license_template_md: 'SECRET-B-WORDING up to 5,000 audio streams.' },
    ],
  };
  db.writes = [];
  db.user = 'user-a';
  db.seq = 0;
  rate.allow = true;
});

const PREMIUM = {
  name: 'Premium WAV', price_usd: 75, file_types: ['MP3', 'WAV'], stems_included: false, is_exclusive: false,
  streaming_limit: 100000, distribution_limit: 50000, commercial_rights: true, sync_rights: false,
  broadcast_rights: false, credit_required: true,
};

describe('create a license, then inspect its contract', () => {
  it('the draft states exactly the terms that were saved', async () => {
    const tier = await createTier('user-a', PREMIUM);
    const res = await GET(new NextRequest(`${U}`), ctx(String(tier.id)));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { draft } = await res.json();
    expect(draft).toMatchObject({ draft: true, sample: true, template_source: 'tier-aware' });
    expect(draft.tier).toMatchObject({ name: 'Premium WAV', source: 'licenses-row', issues: [] });
    expect(draft.verification).toEqual({ ok: true, missing: [], contradicted: [] });
    for (const line of [
      '- License: Premium WAV (Non-exclusive)',
      '- Files delivered: MP3, WAV',
      '- Stems: Not included',
      '- Audio streams: 100,000 streams',
      '- Downloads / physical units: 50,000 copies',
      '- Commercial use: Permitted',
      '- Sync / film: Not permitted',
      '- Broadcast / TV: Not permitted',
      '- Credit: prod. Producer A',
    ]) expect(draft.markdown).toContain(line);
    expect(draft.markdown.endsWith(draft.schedule)).toBe(true);
    expect(draft.markdown.match(/## Schedule of Terms/g)).toHaveLength(1);
  });

  it('an exclusive tier states exclusivity in the schedule whatever the wording says', async () => {
    const tier = await createTier('user-a', { ...PREMIUM, name: 'Exclusive', is_exclusive: true, streaming_limit: null, distribution_limit: null });
    db.tables.creator_profiles[0].license_template_md = '# Deal\n\nThanks for buying.';
    const { draft } = await (await GET(new NextRequest(U), ctx(String(tier.id)))).json();
    expect(draft.template_source).toBe('producer');
    expect(draft.schedule).toContain('License: Exclusive (Exclusive)');
    expect(draft.schedule).toContain('Audio streams: Unlimited');
  });

  it('the PDF is a PDF marked DRAFT, with no stored URL in the response', async () => {
    const tier = await createTier('user-a', PREMIUM);
    const res = await GET(new NextRequest(`${U}?format=pdf`), ctx(String(tier.id)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('legacy sample ids draft the standard terms', async () => {
    for (const id of ['lease', 'exclusive']) {
      const res = await GET(new NextRequest(U), ctx(id));
      expect(res.status).toBe(200);
      expect((await res.json()).draft.tier).toMatchObject({ source: 'legacy', issues: [] });
    }
  });
});

describe('ownership', () => {
  it("another producer's tier is a 404 and none of their data is returned", async () => {
    const theirs = await createTier('user-b', { ...PREMIUM, name: 'B-ONLY-TIER' });
    db.user = 'user-a';
    for (const call of [
      () => GET(new NextRequest(U), ctx(String(theirs.id))),
      () => GET(new NextRequest(`${U}?format=pdf`), ctx(String(theirs.id))),
      () => POST(jsonReq(U, {}), ctx(String(theirs.id))),
    ]) {
      const res = await call();
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toMatch(/B-ONLY-TIER|Producer B|SECRET-B/);
    }
  });

  it("the draft uses the caller's own profile wording, never another producer's", async () => {
    const tier = await createTier('user-a', PREMIUM);
    db.user = 'user-b';
    const theirsOnly = await createTier('user-b', { ...PREMIUM, name: 'B tier' });
    db.user = 'user-a';
    const { draft } = await (await GET(new NextRequest(U), ctx(String(tier.id)))).json();
    expect(JSON.stringify(draft)).not.toMatch(/SECRET-B|Producer B|b@example/);
    expect(theirsOnly.id).not.toBe(tier.id);
  });

  it('signed out is 401', async () => {
    db.user = null;
    expect((await GET(new NextRequest(U), ctx('lease'))).status).toBe(401);
    expect((await POST(jsonReq(U, {}), ctx('lease'))).status).toBe(401);
  });

  it('anything but a uuid or a legacy id is a 404', async () => {
    for (const id of ['premium', '../../etc', '123', 'LEASE ', '00000000-0000-4000-8000-00000000zzzz']) {
      expect((await GET(new NextRequest(U), ctx(id))).status).toBe(404);
    }
  });

  it('a uuid that is nobody\'s tier is a 404', async () => {
    expect((await GET(new NextRequest(U), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(404);
  });
});

describe('a draft never writes', () => {
  it('an unsaved wording is used for the response only', async () => {
    const tier = await createTier('user-a', PREMIUM);
    db.writes = [];
    const res = await POST(jsonReq(U, { template: '# My own deal\n\nUp to 5,000 audio streams.' }), ctx(String(tier.id)));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.template_source).toBe('producer');
    expect(draft.markdown).toContain('My own deal');
    expect(draft.verification.contradicted.join()).toMatch(/5,000 streams/);
    expect(db.writes).toEqual([]);
    expect(db.tables.creator_profiles[0].license_template_md).toBe('');
  });

  it('a pasted Schedule of Terms in the wording is removed and the generated one stands', async () => {
    const tier = await createTier('user-a', PREMIUM);
    const forged = '# Deal\n\n## Schedule of Terms\n\n### Premium WAV\n- Audio streams: Unlimited\n- Files delivered: WAV, STEMS\n';
    const { draft } = await (await POST(jsonReq(U, { template: forged }), ctx(String(tier.id)))).json();
    expect(draft.markdown).not.toContain('Unlimited');
    expect(draft.markdown).not.toContain('WAV, STEMS');
    expect(draft.markdown.match(/## Schedule of Terms/g)).toHaveLength(1);
    expect(draft.markdown.endsWith(draft.schedule)).toBe(true);
    expect(draft.alerts.join()).toMatch(/Schedule of Terms.*removed/);
    expect(draft.verification.ok).toBe(true);
  });

  it('a corrupt tier row never reads as Unlimited: standard terms, flagged', async () => {
    db.tables.licenses.push({ id: '22222222-2222-4222-8222-222222222222', user_id: 'user-a', name: 'Broken', is_exclusive: false, file_types: ['MP3'], stems_included: false, streaming_limit: -5, distribution_limit: null, commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: false });
    const { draft } = await (await GET(new NextRequest(U), ctx('22222222-2222-4222-8222-222222222222'))).json();
    expect(draft.tier.source).toBe('fallback');
    expect(draft.tier.issues.length).toBeGreaterThan(0);
    expect(draft.markdown).not.toMatch(/Audio streams: Unlimited/);
    expect(draft.markdown).toContain('could not be confirmed');
  });
});

describe('limits', () => {
  it('rejects an oversize or unknown body', async () => {
    expect((await POST(jsonReq(U, { template: 'x'.repeat(50001) }), ctx('lease'))).status).toBe(400);
    expect((await POST(jsonReq(U, { template: 'x', extra: 1 }), ctx('lease'))).status).toBe(400);
    expect((await POST(new NextRequest(U, { method: 'POST', body: 'not json' }), ctx('lease'))).status).toBe(400);
  });
  it('is rate limited per user', async () => {
    rate.allow = false;
    const res = await GET(new NextRequest(U), ctx('lease'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});
