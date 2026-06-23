import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireRowOwnership = vi.fn();
const mockTargetUpdate = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  requireRowOwnership: (...args: unknown[]) => mockRequireRowOwnership(...args),
}));

function adminClient() {
  return {
    from(table: string) {
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: 'campaign-1', name: 'Push' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'campaign_targets') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({
                data: [{
                  id: 'target-1',
                  contact_id: 'contact-1',
                  beat_send_id: 'send-old',
                  status: 'sent',
                  last_nudge_at: null,
                  nudge_count: 0,
                  created_at: '2026-06-01T00:00:00.000Z',
                  contacts: { id: 'contact-1', name: 'Artist', email: 'artist@example.com', role: 'rapper' },
                }],
                error: null,
              }),
            }),
          }),
          update: mockTargetUpdate,
        };
      }
      if (table === 'beat_sends') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { id: 'send-old', contact_id: 'contact-1', status: 'sent', sent_at: '2026-06-01T10:00:00.000Z' },
                { id: 'send-new', contact_id: 'contact-1', status: 'placed', sent_at: '2026-06-02T10:00:00.000Z' },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTargetUpdate.mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  });
  mockRequireRowOwnership.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    admin: adminClient(),
  });
});

describe('GET /api/campaigns/[id]', () => {
  it('derives the target funnel status from the latest beat send and repairs the cache', async () => {
    const { GET } = await import('./route');
    const res = await GET(
      new NextRequest('http://localhost/api/campaigns/campaign-1'),
      { params: Promise.resolve({ id: 'campaign-1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targets[0]).toMatchObject({
      contact_id: 'contact-1',
      status: 'placed',
      sends_count: 2,
      last_sent_at: '2026-06-02T10:00:00.000Z',
    });
    expect(mockTargetUpdate).toHaveBeenCalledWith({
      beat_send_id: 'send-new',
      status: 'placed',
    });
  });
});
