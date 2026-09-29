import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCommentInsert = vi.fn();
const mockNotificationInsert = vi.fn();
const mockProjectResult = vi.fn();
const mockShareRow = vi.fn();

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => true,
  getAll: () => [],
  insert: () => null,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimitDurable: () => Promise.resolve(true),
  clientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/share/token-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/share/token-access')>();
  return {
    ...actual,
    resolveShareToken: () => Promise.resolve({ kind: 'project_share', row: mockShareRow() }),
    shareAccessFailure: () => Promise.resolve(null),
  };
});

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === 'project_comments') return { insert: mockCommentInsert };
      if (table === 'notifications') return { insert: mockNotificationInsert };
      if (table === 'projects') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(mockProjectResult()) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

const TOKEN = 'sharetoken1234567890';

function commentRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/share/${TOKEN}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ token: TOKEN }) };

describe('POST /api/projects/share/[token]/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShareRow.mockReturnValue({ id: 's1', token: TOKEN, project_id: 'p1', role: 'commenter', label: 'Artist #1' });
    mockProjectResult.mockReturnValue({ data: { user_id: 'owner-1', name: 'New EP' }, error: null });
    mockCommentInsert.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }),
    });
    mockNotificationInsert.mockResolvedValue({ error: null });
  });

  it('notifies the project owner about a new comment', async () => {
    const { POST } = await import('./route');
    const res = await POST(commentRequest({ author_name: 'Artist #1', body: 'Love beat 2', track_id: 't1' }), params);

    expect(res.status).toBe(200);
    expect(mockNotificationInsert).toHaveBeenCalledWith({
      user_id: 'owner-1',
      kind: 'share_comment',
      title: 'Artist #1 commented on New EP',
      body: 'Love beat 2',
      data: { project_id: 'p1', comment_id: 'c1', share_token: TOKEN, share_label: 'Artist #1', track_id: 't1' },
    });
  });

  it('keeps the comment when the notification fails', async () => {
    mockNotificationInsert.mockRejectedValue(new Error('db down'));
    const { POST } = await import('./route');
    const res = await POST(commentRequest({ author_name: 'Artist #1', body: 'Still here' }), params);

    expect(res.status).toBe(200);
    expect((await res.json()).comment).toEqual({ id: 'c1' });
  });

  it('does not notify when a view-only link is refused', async () => {
    mockShareRow.mockReturnValue({ id: 's1', token: TOKEN, project_id: 'p1', role: 'viewer' });
    const { POST } = await import('./route');
    const res = await POST(commentRequest({ author_name: 'Artist #1', body: 'Hi' }), params);

    expect(res.status).toBe(403);
    expect(mockCommentInsert).not.toHaveBeenCalled();
    expect(mockNotificationInsert).not.toHaveBeenCalled();
  });
});
