import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCommentInsert = vi.fn();
const mockNotificationInsert = vi.fn();
const mockProjectResult = vi.fn();
const mockShareRow = vi.fn();
const mockContactResult = vi.fn();
const mockActivityInsert = vi.fn();

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
      if (table === 'contact_activity') return { insert: mockActivityInsert };
      if (table === 'contacts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(mockContactResult()) }) }) }) };
      }
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
    mockActivityInsert.mockResolvedValue({ error: null });
    mockContactResult.mockReturnValue({ data: { id: 'contact-1', name: 'Alex' }, error: null });
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

  describe('collaborator identity (SHARE-07)', () => {
    const invitedShare = { id: 's1', token: TOKEN, project_id: 'p1', role: 'commenter', label: 'For Alex', contact_id: 'contact-1' };

    it('stamps the invited contact from the share and attributes the notification and timeline', async () => {
      mockShareRow.mockReturnValue(invitedShare);
      const { POST } = await import('./route');
      const res = await POST(commentRequest({ author_name: 'Nova', body: 'darker please' }), params);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(mockCommentInsert.mock.calls[0][0].share_contact_id).toBe('contact-1');
      const note = mockNotificationInsert.mock.calls[0][0];
      expect(note.title).toBe('Nova (Alex) commented on New EP');
      expect(note.data.contact_id).toBe('contact-1');
      expect(mockActivityInsert.mock.calls[0][0]).toMatchObject({ contact_id: 'contact-1', user_id: 'owner-1', kind: 'share_comment' });
      // The public response never carries the contact link.
      expect(JSON.stringify(json)).not.toContain('contact-1');
      expect(JSON.stringify(json)).not.toContain('Alex');
    });

    it('never takes a contact from the request body', async () => {
      const { POST } = await import('./route');
      await POST(commentRequest({ author_name: 'Nova', body: 'hi', share_contact_id: 'evil', contact_id: 'evil' }), params);

      const row = mockCommentInsert.mock.calls[0][0];
      expect(row).not.toHaveProperty('share_contact_id');
      expect(row).not.toHaveProperty('contact_id');
      expect(mockActivityInsert).not.toHaveBeenCalled();
    });

    it('ignores a share contact the owner no longer has', async () => {
      mockShareRow.mockReturnValue(invitedShare);
      mockContactResult.mockReturnValue({ data: null, error: null });
      const { POST } = await import('./route');
      await POST(commentRequest({ author_name: 'Nova', body: 'hi' }), params);

      expect(mockCommentInsert.mock.calls[0][0]).not.toHaveProperty('share_contact_id');
    });

    it('keeps the comment, without attribution, while migration 204 is missing', async () => {
      mockShareRow.mockReturnValue(invitedShare);
      mockCommentInsert
        .mockReturnValueOnce({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column "share_contact_id" does not exist' } }) }) })
        .mockReturnValueOnce({ select: () => ({ single: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }) });
      const { POST } = await import('./route');
      const res = await POST(commentRequest({ author_name: 'Nova', body: 'darker please' }), params);

      expect(res.status).toBe(200);
      expect(mockCommentInsert).toHaveBeenCalledTimes(2);
      expect(mockCommentInsert.mock.calls[1][0]).not.toHaveProperty('share_contact_id');
      expect(mockNotificationInsert.mock.calls[0][0].title).toBe('Nova commented on New EP');
      expect(mockActivityInsert).not.toHaveBeenCalled();
    });
  });
});
