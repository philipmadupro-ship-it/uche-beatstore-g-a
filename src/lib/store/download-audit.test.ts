import { describe, it, expect, vi } from 'vitest';
import { recordDownload, shouldLogGrant, DOWNLOAD_EVENT_TYPE } from './download-audit';
import { STORE_EVENT_TYPES } from '@/lib/store/funnel';
import { StoreEventBodySchema } from '@/lib/contracts';

const TRACK = '11111111-1111-4111-8111-111111111111';
const entry = {
  sellerUserId: 'seller-1', trackId: TRACK, purchaseKind: 'track_license' as const,
  purchaseId: 'purchase-1', format: 'wav', outcome: 'granted' as const, ip: '203.0.113.9',
};

describe('shouldLogGrant', () => {
  it('logs a request for the start of the file', () => {
    expect(shouldLogGrant(null, false)).toBe(true);
    expect(shouldLogGrant('bytes=0-', false)).toBe(true);
    expect(shouldLogGrant('bytes=0-1048575', false)).toBe(true);
  });

  it('does not log the page\'s one-byte pre-check, even though it asks from byte 0', () => {
    expect(shouldLogGrant('bytes=0-0', true)).toBe(false);
  });

  it('does not log a resumed download from the middle of the file', () => {
    expect(shouldLogGrant('bytes=5242880-', false)).toBe(false);
  });
});

describe('recordDownload', () => {
  it('writes a download event with the purchase, format and outcome — and no credential', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await recordDownload({ from: () => ({ insert }) }, entry);

    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      event_type: DOWNLOAD_EVENT_TYPE,
      seller_user_id: 'seller-1',
      track_id: TRACK,
      metadata: { purchase_kind: 'track_license', purchase_id: 'purchase-1', format: 'wav', outcome: 'granted' },
    });
    expect(JSON.stringify(row)).not.toMatch(/cs_|session/);
    // The address is hashed, never stored.
    expect(row.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.9');
  });

  it('records the reason a download was refused', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await recordDownload({ from: () => ({ insert }) }, { ...entry, outcome: 'denied', reason: 'under-review' });
    expect((insert.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata)
      .toMatchObject({ outcome: 'denied', reason: 'under-review' });
  });

  it('never throws: a failed write must not block a paid download', async () => {
    await expect(recordDownload({ from: () => ({ insert: () => Promise.resolve({ error: { message: 'boom' } }) }) }, entry)).resolves.toBeUndefined();
    await expect(recordDownload({ from: () => { throw new Error('no table'); } }, entry)).resolves.toBeUndefined();
  });

  it('keeps a non-uuid track id out of the uuid column', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await recordDownload({ from: () => ({ insert }) }, { ...entry, trackId: 'track-1' });
    expect((insert.mock.calls[0][0] as { track_id: unknown }).track_id).toBeNull();
  });
});

describe('forgery', () => {
  it('is not an event type the public /api/store/event endpoint accepts', () => {
    expect(STORE_EVENT_TYPES as readonly string[]).not.toContain(DOWNLOAD_EVENT_TYPE);
    // ...checked through the schema the endpoint really uses, not just the list.
    expect(StoreEventBodySchema.safeParse({ event_type: DOWNLOAD_EVENT_TYPE, session_id: 's' }).success).toBe(false);
  });
});
