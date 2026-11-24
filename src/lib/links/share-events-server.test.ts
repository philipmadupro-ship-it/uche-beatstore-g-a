import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockRecord = vi.fn(async () => {});
vi.mock('./share-events', () => ({ recordShareEvent: (...a: unknown[]) => mockRecord(...(a as [])) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

const SHARE = '22222222-2222-4222-8222-222222222222';
const req = () => new NextRequest('http://x/api/share/tok', { headers: { 'x-forwarded-for': '9.9.9.9' } });
const flush = () => new Promise((r) => setTimeout(r, 0));
const admin = (owner: string) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: owner } }) }) }) }),
});

beforeEach(() => vi.clearAllMocks());

describe('recordShareEventFor', () => {
  it('records a share link against its own user_id, by row id', async () => {
    const { recordShareEventFor } = await import('./share-events-server');
    recordShareEventFor(req(), admin('x') as never, { kind: 'share_link', row: { id: SHARE, user_id: 'owner-1' } }, 'open');
    await flush();
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'share_links', shareId: SHARE, ownerUserId: 'owner-1', kind: 'open', ip: '9.9.9.9' }));
  });

  it('resolves a project share owner through what it points at', async () => {
    const { recordShareEventFor } = await import('./share-events-server');
    recordShareEventFor(req(), admin('proj-owner') as never, { kind: 'project_share', row: { id: SHARE, content_type: 'project', project_id: 'p1' } }, 'download', 't1');
    await flush();
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'project_shares', ownerUserId: 'proj-owner', trackId: 't1' }));
  });

  it('records nothing for a purchase token or an artist portal', async () => {
    const { recordShareEventFor } = await import('./share-events-server');
    recordShareEventFor(req(), admin('x') as never, { kind: 'paid_access', row: { id: SHARE } }, 'download');
    recordShareEventFor(req(), admin('x') as never, { kind: 'artist_portal', row: { id: SHARE, user_id: 'o' } }, 'open');
    await flush();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
