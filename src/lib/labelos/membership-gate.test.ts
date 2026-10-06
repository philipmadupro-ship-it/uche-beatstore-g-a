import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasAnyLabelOsMembership } from './membership-gate';

type Result = { data: unknown[] | null; error: unknown };

/** One answer for every table, or one per table (`org_members` / `project_members`). */
function client(result: Result | (() => never) | Record<string, Result>) {
  const calls: unknown[][] = [];
  let table = '';
  const builder = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), builder),
    eq: (...a: unknown[]) => (calls.push(['eq', ...a]), builder),
    limit: async (...a: unknown[]) => {
      calls.push(['limit', ...a]);
      if (typeof result === 'function') return result();
      return 'data' in result ? result : (result as Record<string, Result>)[table];
    },
  };
  const from = vi.fn((t: string) => ((table = t), calls.push(['from', t]), builder));
  return { supabase: { from } as unknown as Pick<SupabaseClient, 'from'>, calls };
}

describe('hasAnyLabelOsMembership', () => {
  it('is true when the user has an org_members row', async () => {
    const { supabase, calls } = client({ data: [{ org_id: 'o1' }], error: null });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(true);
    // Reads only the caller's own rows, one is enough.
    expect(calls).toEqual([
      ['from', 'org_members'],
      ['select', 'org_id'],
      ['eq', 'user_id', 'u1'],
      ['limit', 1],
    ]);
  });

  it('is false with no rows (a buyer, or the producer before LABEL-07)', async () => {
    const { supabase } = client({ data: [], error: null });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });

  it('LABEL-21: an external project member with no org is admitted', async () => {
    const { supabase, calls } = client({
      org_members: { data: [], error: null },
      project_members: { data: [{ project_id: 'p1' }], error: null },
    });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(true);
    expect(calls.filter((c) => c[0] === 'from')).toEqual([['from', 'org_members'], ['from', 'project_members']]);
    // Their own rows only.
    expect(calls.filter((c) => c[0] === 'eq')).toEqual([['eq', 'user_id', 'u1'], ['eq', 'user_id', 'u1']]);
  });

  it('LABEL-21: an org member is admitted without a second read', async () => {
    const { supabase, calls } = client({
      org_members: { data: [{ org_id: 'o1' }], error: null },
      project_members: { data: [], error: null },
    });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(true);
    expect(calls.filter((c) => c[0] === 'from')).toEqual([['from', 'org_members']]);
  });

  it('LABEL-21: neither (RLS hides an expired or removed membership) is refused', async () => {
    const { supabase } = client({ org_members: { data: [], error: null }, project_members: { data: [], error: null } });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });

  it('LABEL-21: migration 148 not applied reads as no project membership', async () => {
    const { supabase } = client({
      org_members: { data: [], error: null },
      project_members: { data: null, error: { message: "Could not find the table 'public.project_members'" } },
    });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });

  it('fails closed on a query error (e.g. migration 136 not applied)', async () => {
    const { supabase } = client({ data: null, error: { message: 'relation does not exist' } });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });

  it('fails closed when the client throws', async () => {
    const { supabase } = client(() => {
      throw new Error('network');
    });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });

  it('fails closed on null data', async () => {
    const { supabase } = client({ data: null, error: null });
    expect(await hasAnyLabelOsMembership(supabase, 'u1')).toBe(false);
  });
});
