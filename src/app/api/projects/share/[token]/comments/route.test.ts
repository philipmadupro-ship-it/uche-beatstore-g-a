import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockCommentInsert = vi.fn();
const mockNotificationInsert = vi.fn();
const mockOwnerId = vi.fn();
const mockTrackTitle = vi.fn();

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TRACK_ID = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'share-token-abcdef';

let shareRole = 'commenter';

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => true,
  getAll: () => [],
  insert: () => ({}),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimitDurable: () => Promise.resolve(true),
  clientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/share/share-owner', () => ({
  projectShareOwnerId: (...args: unknown[]) => mockOwnerId(...args),
}));

vi.mock('@/lib/share/token-access', () => ({
  isWellFormedShareToken: () => true,
  resolveShareToken: () => Promise.resolve({
    kind: 'project_share',
    row: { token: TOKEN, project_id: PROJECT_ID, content_type: 'project', role: shareRole },
  }),
  shareAccessFailure: () => Promise.resolve(null),
  shareGateResponse: () => NextResponse.json({ error: 'gate' }, { status: 403 }),
  shareNotFoundResponse: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
  sharePasswordFrom: () => '',
}));

function maybeSingleAfter(eqs: number, result: () => unknown) {
  const chain: Record<string, unknown> = {};
  let count = 0;
  chain.eq = () => {
    count += 1;
    return count >= eqs ? { maybeSingle: () => Promise.resolve(result()) } : chain;
  };
  return chain;
}

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === 'project_comments') return { insert: mockCommentInsert };
      if (table === 'notifications') return { insert: mockNotificationInsert };
      if (table === 'projects') {
        return { select: () => maybeSingleAfter(2, () => ({ data: { name: 'New EP' }, error: null })) };
      }
      if (table === 'tracks') {
        return { select: () => maybeSingleAfter(2, () => mockTrackTitle()) };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function commentRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/share/${TOKEN}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ token: TOKEN }) };

beforeEach(() => {
  vi.clearAllMocks();
  shareRole = 'commenter';
  mockOwnerId.mockResolvedValue('owner-1');
  mockTrackTitle.mockReturnValue({ data: { title: 'MIDNIGHT' }, error: null });
  mockNotificationInsert.mockResolvedValue({ error: null });
  mockCommentInsert.mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'comment-1' }, error: null }) }),
  });
});

describe('POST /api/projects/share/[token]/comments', () => {
  it('notifies the project owner when a guest comments', async () => {
    const { POST } = await import('./route');
    const res = await POST(commentRequest({
      author_name: 'Artist #1',
      body: 'Hook hits hard here',
      track_id: TRACK_ID,
      region_start: 30,
      region_end: 45,
    }), params);

    expect(res.status).toBe(200);
    expect(mockNotificationInsert).toHaveBeenCalledTimes(1);
    const row = mockNotificationInsert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: 'owner-1',
      kind: 'share_comment',
      title: 'Artist #1 commented on New EP',
      body: '“MIDNIGHT” · 0:30–0:45 · Hook hits hard here',
    });
    expect(JSON.stringify(row)).not.toContain(TOKEN);
  });

  it('does not name a track the owner does not own', async () => {
    mockTrackTitle.mockReturnValue({ data: null, error: null });
    const { POST } = await import('./route');
    await POST(commentRequest({ author_name: 'Artist #1', body: 'Nice', track_id: TRACK_ID }), params);

    const row = mockNotificationInsert.mock.calls[0][0];
    expect(row.body).toBe('Nice');
    expect(row.data.track_id).toBeNull();
  });

  it('still saves the comment when the notification cannot be written', async () => {
    mockNotificationInsert.mockResolvedValue({ error: { message: 'boom' } });
    const { POST } = await import('./route');
    const res = await POST(commentRequest({ author_name: 'Artist #1', body: 'Nice' }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ comment: { id: 'comment-1' } });
  });

  it('notifies nobody when a view-only link is refused', async () => {
    shareRole = 'viewer';
    const { POST } = await import('./route');
    const res = await POST(commentRequest({ author_name: 'Artist #1', body: 'Nice' }), params);

    expect(res.status).toBe(403);
    expect(mockCommentInsert).not.toHaveBeenCalled();
    expect(mockNotificationInsert).not.toHaveBeenCalled();
  });
});
