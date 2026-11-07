/**
 * What the metadata approval covers of a release (LABEL-55, migration 175):
 * territories, language and the planned distributor are part of the facts a
 * snapshot is taken from, so changing one after approval stales it — and on a
 * database without 175 the facts are still read, without them.
 */
import { describe, expect, it, vi } from 'vitest';
import { memoryAdmin } from '@/lib/labelos/mocks/memory-db';
import type { AdminClient } from '@/lib/auth/ownership';

vi.mock('server-only', () => ({}));

const ORG = '10000000-0000-4000-8000-000000000001';
const REL = '70000000-0000-4000-8000-000000000001';

const release = (over: Record<string, unknown> = {}) => ({
  id: REL, org_id: ORG, contact_id: '30000000-0000-4000-8000-0000000000c1', project_id: '40000000-0000-4000-8000-0000000000a1', artwork_asset_id: null,
  title: 'EP', type: 'ep', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null, target_date: null, release_date: null,
  distributor: 'DistroKid', territories: ['US', 'GB'], language: 'en', ...over,
});

async function facts(row: Record<string, unknown>, missingDetails = false) {
  const { readReleaseFacts } = await import('./approvals-store');
  const mem = memoryAdmin({ rpc: {}, tables: { releases: [row], release_items: [] } });
  const admin = (missingDetails
    ? {
        from: (table: string) => {
          const q = mem.client.from(table) as unknown as { select: (cols: string) => unknown };
          if (table !== 'releases') return q;
          const select = q.select.bind(q);
          q.select = (cols: string) => {
            if (/territories/.test(cols)) {
              const res = { data: null, error: { code: '42703', message: 'column releases.territories does not exist' } };
              const b: Record<string, unknown> = {};
              for (const m of ['eq', 'order']) b[m] = () => b;
              b.maybeSingle = async () => res;
              return b;
            }
            return select(cols);
          };
          return q;
        },
      }
    : mem.client) as unknown as AdminClient;
  return readReleaseFacts(admin, ORG, REL);
}

describe('readReleaseFacts: the details are part of the metadata snapshot', () => {
  it('carries distributor, language and territories (comma-joined)', async () => {
    const f = await facts(release());
    expect(f?.fields).toMatchObject({ distributor: 'DistroKid', language: 'en', territories: 'US,GB' });
  });

  it('changing territories changes the facts, so an approval taken on the old ones goes stale', async () => {
    const before = await facts(release());
    const after = await facts(release({ territories: ['US', 'GB', 'FR'] }));
    expect(JSON.stringify(after?.fields)).not.toBe(JSON.stringify(before?.fields));
    expect((await facts(release({ territories: null })))?.fields.territories).toBeNull();
  });

  it('before 175 the facts are still read, without the three details', async () => {
    const f = await facts(release(), true);
    expect(f).not.toBeNull();
    expect(f?.fields).toMatchObject({ title: 'EP', type: 'ep' });
    expect(f?.fields).not.toHaveProperty('territories');
  });
});
