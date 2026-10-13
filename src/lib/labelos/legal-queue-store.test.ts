import { describe, expect, it } from 'vitest';
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { loadLegalQueue } from './legal-queue-store';

const access = (error: { code?: string; message: string }) => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.order = async () => ({ data: null, error });
  return { admin: { from: () => chain }, orgId: 'o', userId: 'u', capabilities: new Set() } as unknown as OrgAccessOk;
};

describe('loadLegalQueue before migration 157', () => {
  it('answers schemaReady false instead of failing', async () => {
    const q = await loadLegalQueue(access({ code: 'PGRST205', message: "Could not find the table 'public.approvals' in the schema cache" }));
    expect(q).toEqual({ schemaReady: false, items: [], restricted: 0, truncated: false });
  });
  it('any other database error is an error, not an empty queue', async () => {
    await expect(loadLegalQueue(access({ code: '57014', message: 'statement timeout' }))).rejects.toThrow(/approval list/);
  });
});
