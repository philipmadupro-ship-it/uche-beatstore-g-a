/**
 * loadReleaseDetail and the skipped-approval notice (LABEL-51): the switches
 * are read on their own, and a failed read is "no banner" (logged), never a
 * 500 for the whole release page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, type Answer, type Chain } from './mocks/fake-admin';

const logged: unknown[][] = [];
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: (...a: unknown[]) => logged.push(a) }) }));
vi.mock('@/lib/auth/org-access', () => ({ requireObjectAccess: async () => ({ ok: false }) }));
vi.mock('./release-readiness-store', () => ({
  loadReleaseReadinessFacts: async () => null,
  ReleaseReadinessNotReadyError: class extends Error {},
}));

const ORG = 'o1';
let settingsAnswer: Answer;

const RELEASE = {
  id: 'r1', project_id: 'p1', contact_id: 'c1', title: 'EP', type: 'ep', upc: null, label_name: null, c_line: null, p_line: null, primary_genre: null,
  target_date: null, release_date: null, artwork_asset_id: null, state: 'draft', delivered_at: null, delivered_to: null, imported_released: false,
  store_listed: false, store_listed_at: null, created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

function access() {
  const admin = fakeAdmin({
    answer: (chain: Chain): Answer => {
      if (chain.table === 'releases') return { data: RELEASE, error: null };
      if (chain.table === 'organizations') return settingsAnswer;
      return { data: [], error: null };
    },
  });
  return { ok: true, admin: admin.client, object: { orgId: ORG, id: 'r1' }, capabilities: new Set(['catalog.read']), role: 'owner' } as never;
}

const { loadReleaseDetail } = await import('./release-detail-store');

beforeEach(() => {
  logged.length = 0;
  settingsAnswer = { data: { settings: {} }, error: null };
});

describe('gatesSkipped on the release detail', () => {
  it('names the approvals the owner switched off', async () => {
    settingsAnswer = { data: { settings: { legal_gate: 'off', marketing_gate: 'on' } }, error: null };
    expect((await loadReleaseDetail(access()))!.gatesSkipped).toEqual(['legal']);
  });

  it('is empty by default', async () => {
    expect((await loadReleaseDetail(access()))!.gatesSkipped).toEqual([]);
  });

  it('a failed settings read does not fail the page: no skipped gates, and it is logged', async () => {
    settingsAnswer = { data: null, error: { message: 'connection reset' } };
    const detail = await loadReleaseDetail(access());
    expect(detail).not.toBeNull();
    expect(detail!.gatesSkipped).toEqual([]);
    expect(logged.length).toBe(1);
  });
});
