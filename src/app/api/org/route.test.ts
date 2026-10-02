/**
 * GET /api/org (LABEL-09): the switcher's list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

let mine: unknown;
vi.mock('@/lib/auth/org-access', () => ({ myOrganizations: async () => mine }));

const { GET } = await import('./route');

beforeEach(() => {
  mine = { ok: true, userId: 'u', isProducer: true, orgs: [] };
});

describe('GET /api/org', () => {
  it('each org carries its home; the producer’s own org is the dashboard', async () => {
    mine = {
      ok: true,
      userId: 'u',
      isProducer: true,
      orgs: [
        { id: 'a', name: 'Night Shift', slug: 'night-shift', kind: 'label', role: 'member' },
        { id: 'b', name: 'Uche', slug: 'uche', kind: 'producer', role: 'owner' },
      ],
    };
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      orgs: [
        { id: 'a', name: 'Night Shift', slug: 'night-shift', kind: 'label', role: 'member', home: '/o/night-shift' },
        { id: 'b', name: 'Uche', slug: 'uche', kind: 'producer', role: 'owner', home: '/library' },
      ],
      shared: [],
    });
  });

  it('passes a refusal through', async () => {
    mine = { ok: false, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
    expect((await GET()).status).toBe(401);
  });
});
