import { describe, expect, it, vi } from 'vitest';
import { OPEN_DEDUPE_MS, recordShareEvent, type EventClient } from './share-events';
import { hashClientIp } from '@/lib/security/ip-hash';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SHARE = '22222222-2222-4222-8222-222222222222';
const TRACK = '33333333-3333-4333-8333-333333333333';

function fake(opts: { recent?: boolean; readError?: boolean; insertThrows?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const filters: [string, unknown][] = [];
  const client: EventClient = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'limit']) {
        q[m] = (...a: unknown[]) => {
          if (m === 'eq' || m === 'gte') filters.push([a[0] as string, a[1]]);
          return q;
        };
      }
      (q as { then: unknown }).then = (res: (v: unknown) => void) =>
        res({ data: opts.recent ? [{ id: 'x' }] : [], error: opts.readError ? { message: 'boom' } : null });
      q.insert = async (row: Record<string, unknown>) => {
        if (opts.insertThrows) throw new Error('down');
        inserted.push(row);
        return { error: null };
      };
      return q;
    },
  };
  return { client, inserted, filters };
}

const base = { source: 'share_links' as const, shareId: SHARE, ownerUserId: OWNER, ip: '1.2.3.4' };

describe('recordShareEvent', () => {
  it('writes the row id, owner and the shared salted hash, never a token or raw IP', async () => {
    const f = fake();
    await recordShareEvent(f.client, { ...base, kind: 'download', trackId: TRACK });
    expect(f.inserted).toEqual([
      { share_source: 'share_links', share_id: SHARE, owner_user_id: OWNER, kind: 'download', track_id: TRACK, ip_hash: hashClientIp('1.2.3.4') },
    ]);
  });

  it('dedupes an open by (share, visitor) inside 30 minutes', async () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    const f = fake({ recent: true });
    await recordShareEvent(f.client, { ...base, kind: 'open' }, now);
    expect(f.inserted).toHaveLength(0);
    expect(f.filters).toContainEqual(['created_at', new Date(now - OPEN_DEDUPE_MS).toISOString()]);
    const g = fake({ recent: false });
    await recordShareEvent(g.client, { ...base, kind: 'open' }, now);
    expect(g.inserted).toHaveLength(1);
  });

  it('does not dedupe plays or downloads', async () => {
    const f = fake({ recent: true });
    await recordShareEvent(f.client, { ...base, kind: 'play', trackId: TRACK });
    expect(f.inserted).toHaveLength(1);
  });

  it('records nothing for the owner previewing their own link or without an owner / uuid', async () => {
    const f = fake();
    await recordShareEvent(f.client, { ...base, kind: 'open', viewerUserId: OWNER });
    await recordShareEvent(f.client, { ...base, kind: 'open', ownerUserId: null });
    await recordShareEvent(f.client, { ...base, kind: 'open', shareId: 'not-a-uuid' });
    expect(f.inserted).toHaveLength(0);
  });

  it('never throws: a failed read or write is swallowed', async () => {
    const warn = vi.fn();
    void warn;
    await expect(recordShareEvent(fake({ readError: true }).client, { ...base, kind: 'open' })).resolves.toBeUndefined();
    await expect(recordShareEvent(fake({ insertThrows: true }).client, { ...base, kind: 'download' })).resolves.toBeUndefined();
  });
});
