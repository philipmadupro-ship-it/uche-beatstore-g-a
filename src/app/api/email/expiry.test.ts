/**
 * The beat-send email's permissions row must describe the link it carries.
 * The follow-up nudge re-sends an existing share without `expiresDays`, and
 * the route used to fall back to 30 — so every nudged recipient read "Link
 * expires in 30 days" whatever the link actually did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockSend = vi.fn();
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
let shareRow: Row | null = null;

/** PostgREST stand-in that really filters on `eq`. */
function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  reads.push({ table, filters });
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
    maybeSingle: async () => {
      const rows = table === 'share_links' && shareRow ? [shareRow] : (tables[table] ?? []);
      return { data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null };
    },
  };
  return q;
}

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: async () => ({ ok: true, userId: 'producer-1', admin: { from } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      insert: () => chain, select: () => chain, eq: () => chain, upsert: async () => ({}),
      maybeSingle: async () => ({ data: { id: 'send-1' } }),
    });
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'producer-1' } } }) },
      from: () => chain,
    };
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/local-store', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));

function nudge(extra: Record<string, unknown> = {}) {
  // Exactly what NudgeModal sends: no expiresDays, no allowDownloads.
  return new NextRequest('http://localhost/api/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contactId: 'c-1', email: 'artist@example.com', trackIds: ['t-1'],
      shareToken: 'abcdef123', message: 'Following up', ...extra,
    }),
  });
}

function sentHtml(): string {
  return (mockSend.mock.calls[0][0] as { html: string }).html;
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.length = 0;
  shareRow = null;
  tables.project_shares = [];
  tables.projects = [];
  vi.stubEnv('RESEND_API_KEY', 're_test');
  mockSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
});

describe('POST /api/email — link expiry comes from the share row', () => {
  it('a never-expiring link is described as having no expiry, not 30 days', async () => {
    shareRow = { token: 'abcdef123', user_id: 'producer-1', expires_at: null, revoked_at: null, allow_downloads: true };
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(200);
    expect(sentHtml()).toContain('No expiry');
    expect(sentHtml()).not.toMatch(/30 days?/);
  });

  it('a long-lived link shows its real expiry date, beyond 30 days', async () => {
    shareRow = { token: 'abcdef123', user_id: 'producer-1', expires_at: '2027-03-15T12:00:00.000Z', revoked_at: null, allow_downloads: true };
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(200);
    expect(sentHtml()).toContain('Link expires Mar 15, 2027');
  });

  it('ignores a client-supplied day count that contradicts the row', async () => {
    shareRow = { token: 'abcdef123', user_id: 'producer-1', expires_at: null, revoked_at: null, allow_downloads: false };
    const { POST } = await import('./route');
    await POST(nudge({ expiresDays: 7, allowDownloads: true }));

    expect(sentHtml()).toContain('No expiry');
    expect(sentHtml()).not.toContain('7 days');
  });

  it('refuses to email a link that has already expired', async () => {
    shareRow = { token: 'abcdef123', user_id: 'producer-1', expires_at: '2020-01-01T00:00:00.000Z', revoked_at: null, allow_downloads: true };
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses to email a revoked link', async () => {
    shareRow = { token: 'abcdef123', user_id: 'producer-1', expires_at: null, revoked_at: '2026-01-01T00:00:00.000Z', allow_downloads: true };
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("will not email another owner's link (owner filter applied)", async () => {
    shareRow = { token: 'abcdef123', user_id: 'someone-else', expires_at: null, revoked_at: null, allow_downloads: true };
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(404);
    const shareRead = reads.find((r) => r.table === 'share_links');
    expect(shareRead?.filters).toContainEqual(['user_id', 'producer-1']);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('POST /api/email — project share tokens', () => {
  const PROJECT = '33333333-3333-4333-8333-333333333333';

  it('a project share is emailed as its /projects/share/ link, not /share/', async () => {
    tables.project_shares = [{ token: 'abcdef123', project_id: PROJECT, expires_at: null, revoked_at: null, allow_downloads: false }];
    tables.projects = [{ id: PROJECT, user_id: 'producer-1' }];
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(200);
    expect(sentHtml()).toContain('/projects/share/abcdef123');
    expect(sentHtml()).not.toMatch(/(?<!\/projects)\/share\/abcdef123/);
    expect(sentHtml()).toContain('No expiry');
    expect(sentHtml()).toContain('Open project');
  });

  it("another producer's project share is not found", async () => {
    tables.project_shares = [{ token: 'abcdef123', project_id: PROJECT, expires_at: null, revoked_at: null }];
    tables.projects = [{ id: PROJECT, user_id: 'someone-else' }];
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('an expired project share is refused', async () => {
    tables.project_shares = [{ token: 'abcdef123', project_id: PROJECT, expires_at: '2020-01-01T00:00:00Z', revoked_at: null }];
    tables.projects = [{ id: PROJECT, user_id: 'producer-1' }];
    const { POST } = await import('./route');
    const res = await POST(nudge());

    expect(res.status).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
