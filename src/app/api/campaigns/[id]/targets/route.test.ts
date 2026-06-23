import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireRowOwnership = vi.fn();
const mockBeatSendInsert = vi.fn();
const mockTargetUpsert = vi.fn();
const mockProjectResult = vi.fn();
const mockShareResult = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireRowOwnership: (...args: unknown[]) => mockRequireRowOwnership(...args),
}));

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';

function filteredMaybeSingle(result: () => unknown, eqs = 2) {
  const chain: Record<string, unknown> = {};
  let count = 0;
  chain.eq = () => {
    count += 1;
    return count >= eqs
      ? { maybeSingle: () => Promise.resolve(result()) }
      : chain;
  };
  return chain;
}

function adminClient() {
  return {
    from(table: string) {
      if (table === 'contacts') {
        return {
          select: () => filteredMaybeSingle(() => ({ data: { id: CONTACT_ID }, error: null })),
        };
      }
      if (table === 'projects') {
        return {
          select: () => filteredMaybeSingle(() => mockProjectResult()),
        };
      }
      if (table === 'project_shares') {
        return {
          select: () => filteredMaybeSingle(() => mockShareResult(), 3),
        };
      }
      if (table === 'project_tracks') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({
                data: [{ track_id: '55555555-5555-4555-8555-555555555555' }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'beat_sends') {
        return { insert: mockBeatSendInsert };
      }
      if (table === 'campaign_targets') {
        return { upsert: mockTargetUpsert };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function projectSendRequest() {
  return new NextRequest(`http://localhost/api/campaigns/${CAMPAIGN_ID}/targets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project_send: {
        contact_id: CONTACT_ID,
        project_id: PROJECT_ID,
        share_id: SHARE_ID,
        share_token: 'project-share-token',
        message: 'New project for you',
        email_resend_id: 'resend-1',
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectResult.mockReturnValue({ data: { id: PROJECT_ID }, error: null });
  mockShareResult.mockReturnValue({ data: { id: SHARE_ID, token: 'project-share-token' }, error: null });
  mockBeatSendInsert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({
        data: { id: 'send-1', contact_id: CONTACT_ID, status: 'sent', sent_at: '2026-06-22T10:00:00.000Z' },
        error: null,
      }),
    }),
  });
  mockTargetUpsert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({
        data: { id: 'target-1', contact_id: CONTACT_ID, beat_send_id: 'send-1', status: 'sent' },
        error: null,
      }),
    }),
  });
  mockRequireRowOwnership.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    admin: adminClient(),
  });
});

describe('POST /api/campaigns/[id]/targets project_send', () => {
  it('creates a campaign beat send and links the target after the project invite succeeds', async () => {
    const { POST } = await import('./route');
    const res = await POST(projectSendRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) });

    expect(res.status).toBe(200);
    expect(mockBeatSendInsert).toHaveBeenCalledWith({
      contact_id: CONTACT_ID,
      track_ids: ['55555555-5555-4555-8555-555555555555'],
      share_token: 'project-share-token',
      message: 'New project for you',
      status: 'sent',
      campaign_id: CAMPAIGN_ID,
      email_resend_id: 'resend-1',
    });
    expect(mockTargetUpsert).toHaveBeenCalledWith({
      campaign_id: CAMPAIGN_ID,
      contact_id: CONTACT_ID,
      beat_send_id: 'send-1',
      status: 'sent',
    }, { onConflict: 'campaign_id,contact_id' });
  });

  it('does not create tracking rows for a project the caller does not own', async () => {
    mockProjectResult.mockReturnValueOnce({ data: null, error: null });

    const { POST } = await import('./route');
    const res = await POST(projectSendRequest(), { params: Promise.resolve({ id: CAMPAIGN_ID }) });

    expect(res.status).toBe(404);
    expect(mockBeatSendInsert).not.toHaveBeenCalled();
    expect(mockTargetUpsert).not.toHaveBeenCalled();
  });
});
