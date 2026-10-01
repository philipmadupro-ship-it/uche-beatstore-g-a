import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasAnyLabelOsMembership } from './membership-gate';

type Result = { data: unknown[] | null; error: unknown };

function client(result: Result | (() => never)) {
  const calls: unknown[][] = [];
  const builder = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), builder),
    eq: (...a: unknown[]) => (calls.push(['eq', ...a]), builder),
    limit: async (...a: unknown[]) => {
      calls.push(['limit', ...a]);
      return typeof result === 'function' ? result() : result;
    },
  };
  const from = vi.fn((table: string) => (calls.push(['from', table]), builder));
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
