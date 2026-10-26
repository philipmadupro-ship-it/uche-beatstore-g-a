/**
 * Go-live order: the producer's list and ownership helpers must keep working on
 * a database where migration 141 (`tracks.org_id` / `projects.org_id`) is not
 * applied yet, because the app may be deployed before the Label OS bundle is
 * pasted. PostgREST answers a mention of the missing column with 42703; the
 * helpers drop their org filter then — and only then.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isMissingOrgColumn } from './org-column';

const ME = '20000000-0000-4000-8000-000000000001';
const MISSING = { code: '42703', message: 'column tracks.org_id does not exist' };
let hasOrgColumn = true;
let otherError: { code: string; message: string } | null = null;
const rows = [{ id: 't1', user_id: ME }];

// Just enough of the query builder: records whether org_id was mentioned.
function from() {
  let mentionsOrg = false;
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['select', 'order', 'or', 'eq', 'gte', 'lte', 'in', 'range']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'select' && typeof args[0] === 'string' && /org_id/.test(args[0])) mentionsOrg = true;
      return chain();
    };
  }
  b.is = (col: string) => {
    if (col === 'org_id') mentionsOrg = true;
    return chain();
  };
  const result = () => {
    if (otherError) return { data: null, error: otherError };
    if (mentionsOrg && !hasOrgColumn) return { data: null, error: MISSING };
    return { data: rows, error: null };
  };
  b.maybeSingle = async () => {
    const r = result();
    return { data: r.data ? rows[0] : null, error: r.error };
  };
  b.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));

import { requireRowOwnership } from './ownership';
import { scopedList } from '@/lib/db';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  hasOrgColumn = false;
  otherError = null;
});

describe('isMissingOrgColumn', () => {
  it('matches only an error that names org_id', () => {
    expect(isMissingOrgColumn(MISSING)).toBe(true);
    expect(isMissingOrgColumn({ code: 'PGRST204', message: "Could not find the 'org_id' column of 'tracks' in the schema cache" })).toBe(true);
    expect(isMissingOrgColumn({ code: '42703', message: 'column tracks.song_stage does not exist' })).toBe(false);
    expect(isMissingOrgColumn({ code: '42501', message: 'permission denied for table org_id_log' })).toBe(false);
    expect(isMissingOrgColumn(null)).toBe(false);
  });
});

describe('producer helpers before migration 141', () => {
  it('scopedList returns the producer rows instead of a 500', async () => {
    for (const table of ['tracks', 'projects'] as const) {
      const out = await scopedList<{ id: string }>(table, { includeNullOwner: false });
      expect(Array.isArray(out), table).toBe(true);
      expect((out as { id: string }[]).map((r) => r.id)).toEqual(['t1']);
    }
  });

  it('requireRowOwnership still answers for the owner', async () => {
    const res = await requireRowOwnership('tracks', 't1');
    expect(res.ok).toBe(true);
  });

  it('any other error is still an error (the plain read would admit org rows)', async () => {
    otherError = { code: '42501', message: 'permission denied for table tracks' };
    const out = await scopedList('tracks', { includeNullOwner: false });
    expect(Array.isArray(out)).toBe(false);
    const res = await requireRowOwnership('tracks', 't1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.res.status).toBe(500);
  });
});
