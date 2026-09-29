import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireRowOwnership = vi.fn();
const mockEmailSend = vi.fn();
const mockBeatSendInsert = vi.fn();
const mockContactResult = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  requireRowOwnership: (...args: unknown[]) => mockRequireRowOwnership(...args),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockEmailSend(...args) };
  },
}));

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

function maybeSingleAfter(eqs: number, result: () => unknown) {
  const chain: Record<string, unknown> = {};
  let count = 0;
  chain.eq = () => {
    count += 1;
    return count >= eqs ? { maybeSingle: () => Promise.resolve(result()) } : chain;
  };
  return chain;
}

function adminClient() {
  return {
    from(table: string) {
      if (table === 'project_shares') {
        return {
          select: () => maybeSingleAfter(1, () => ({
            data: {
              id: SHARE_ID,
              project_id: PROJECT_ID,
              token: 'share-token-abc',
              role: 'viewer',
              allow_downloads: false,
              invited_email: 'artist@example.com',
              expires_at: null,
              revoked_at: null,
            },
            error: null,
          })),
        };
      }
      if (table === 'projects') {
        return { select: () => maybeSingleAfter(1, () => ({ data: { name: 'New EP', cover_url: null }, error: null })) };
      }
      if (table === 'contacts') {
        return { select: () => maybeSingleAfter(2, () => mockContactResult()) };
      }
      if (table === 'project_tracks') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [{ track_id: 't-1' }, { track_id: 't-2' }], error: null }),
            }),
          }),
        };
      }
      if (table === 'beat_sends') {
        return { insert: mockBeatSendInsert };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function inviteRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/shares/${SHARE_ID}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: PROJECT_ID, shareId: SHARE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_test';
  mockEmailSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
  mockContactResult.mockReturnValue({ data: { id: CONTACT_ID }, error: null });
  mockBeatSendInsert.mockReturnValue({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'send-1' }, error: null }) }),
  });
  mockRequireRowOwnership.mockResolvedValue({ ok: true, userId: 'user-1', admin: adminClient() });
});

describe('POST /api/projects/[id]/shares/[shareId]/invite', () => {
  it('records a direct project send in beat_sends when given a contact id', async () => {
    const { POST } = await import('./route');
    const res = await POST(inviteRequest({ email: 'artist@example.com', message: 'Have a listen', contact_id: CONTACT_ID }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, resendId: 'resend-1', beatSendId: 'send-1' });
    expect(mockBeatSendInsert).toHaveBeenCalledWith({
      contact_id: CONTACT_ID,
      track_ids: ['t-1', 't-2'],
      share_token: 'share-token-abc',
      message: 'Have a listen',
      status: 'sent',
      campaign_id: null,
      email_resend_id: 'resend-1',
    });
  });

  it('writes no beat_sends row without a contact id (campaign sends are recorded elsewhere)', async () => {
    const { POST } = await import('./route');
    const res = await POST(inviteRequest({ email: 'artist@example.com' }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, beatSendId: null });
    expect(mockBeatSendInsert).not.toHaveBeenCalled();
  });

  it('does not record a send against a contact the caller does not own', async () => {
    mockContactResult.mockReturnValue({ data: null, error: null });
    const { POST } = await import('./route');
    const res = await POST(inviteRequest({ contact_id: CONTACT_ID }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, beatSendId: null });
    expect(mockBeatSendInsert).not.toHaveBeenCalled();
  });

  it('still reports the invite as sent when recording the send fails', async () => {
    mockBeatSendInsert.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
    });
    const { POST } = await import('./route');
    const res = await POST(inviteRequest({ contact_id: CONTACT_ID }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, beatSendId: null });
  });

  it('rejects a malformed contact id', async () => {
    const { POST } = await import('./route');
    const res = await POST(inviteRequest({ contact_id: 'not-a-uuid' }), params);

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});
