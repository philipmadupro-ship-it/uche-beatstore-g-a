import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateServiceClient = vi.fn();
const mockBeatSendUpdate = vi.fn();
const mockTargetUpdate = vi.fn();

vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

function resolvedEq(result: unknown) {
  const chain = {
    eq: vi.fn(),
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };
  chain.eq.mockReturnValue(chain);
  return chain;
}

function adminClient(status: 'sent' | 'interested') {
  return {
    from(table: string) {
      if (table === 'beat_sends') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
            data: [{
                id: 'send-1',
                campaign_id: 'campaign-1',
                contact_id: 'contact-1',
                status,
              opened_at: null,
            }],
            error: null,
            }),
          }),
          update: mockBeatSendUpdate,
        };
      }
      if (table === 'campaign_targets') {
        return { update: mockTargetUpdate };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function openedRequest() {
  return new NextRequest('http://localhost/api/resend/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'email.opened', data: { email_id: 'resend-1' } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_WEBHOOK_SECRET;
  mockBeatSendUpdate.mockReturnValue(resolvedEq({ error: null }));
  mockTargetUpdate.mockReturnValue(resolvedEq({ error: null }));
});

describe('POST /api/resend/webhook', () => {
  it('moves the beat send and its currently linked campaign target to opened', async () => {
    mockCreateServiceClient.mockReturnValue(adminClient('sent'));

    const { POST } = await import('./route');
    const res = await POST(openedRequest());

    expect(res.status).toBe(200);
    expect(mockBeatSendUpdate).toHaveBeenCalledWith(expect.objectContaining({
      opened_at: expect.any(String),
      status: 'opened',
    }));
    expect(mockTargetUpdate).toHaveBeenCalledWith({ status: 'opened' });
    const targetChain = mockTargetUpdate.mock.results[0].value;
    expect(targetChain.eq).toHaveBeenNthCalledWith(1, 'campaign_id', 'campaign-1');
    expect(targetChain.eq).toHaveBeenNthCalledWith(2, 'contact_id', 'contact-1');
    expect(targetChain.eq).toHaveBeenNthCalledWith(3, 'beat_send_id', 'send-1');
  });

  it('records the first open timestamp without downgrading an advanced funnel status', async () => {
    mockCreateServiceClient.mockReturnValue(adminClient('interested'));

    const { POST } = await import('./route');
    const res = await POST(openedRequest());

    expect(res.status).toBe(200);
    expect(mockBeatSendUpdate).toHaveBeenCalledWith({
      opened_at: expect.any(String),
    });
    expect(mockTargetUpdate).not.toHaveBeenCalled();
  });
});
