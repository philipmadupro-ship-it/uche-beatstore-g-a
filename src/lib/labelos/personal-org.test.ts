import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ENSURE_PRODUCER_ORG_RPC,
  ensurePersonalOrg,
  interpretEnsureResult,
  type PersonalOrgAdmin,
} from './personal-org';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-00000000000a';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResult: RpcResult | Error = { data: { org_id: ORG, created: true }, error: null };
let inserted: { table: string; row: Record<string, unknown> }[] = [];
let insertResult: { data: unknown; error: { message: string } | null } | Error = { data: { id: 'ev-1' }, error: null };

const admin = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (rpcResult instanceof Error) throw rpcResult;
    return rpcResult;
  },
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      inserted.push({ table, row });
      return {
        select: () => ({
          single: async () => {
            if (insertResult instanceof Error) throw insertResult;
            return insertResult;
          },
        }),
      };
    },
  }),
} as unknown as PersonalOrgAdmin;

beforeEach(() => {
  rpcCalls = [];
  inserted = [];
  rpcResult = { data: { org_id: ORG, created: true }, error: null };
  insertResult = { data: { id: 'ev-1' }, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('interpretEnsureResult', () => {
  it('reads a created org', () => {
    expect(interpretEnsureResult({ org_id: ORG, created: true }, null)).toEqual({ status: 'created', orgId: ORG });
  });

  it('reads an existing org', () => {
    expect(interpretEnsureResult({ org_id: ORG, created: false }, null)).toEqual({ status: 'exists', orgId: ORG });
  });

  it('reads a non-producer (buyer) as skipped', () => {
    expect(interpretEnsureResult({ skipped: 'not_producer' }, null)).toEqual({ status: 'skipped', reason: 'not_producer' });
  });

  it.each([
    ['function not in the schema cache (PostgREST)', { code: 'PGRST202', message: 'Could not find the function public.labelos_ensure_producer_org(p_user) in the schema cache' }],
    ['undefined function (Postgres)', { code: '42883', message: 'function public.labelos_ensure_producer_org(uuid) does not exist' }],
    ['undefined table inside the function (136 missing)', { code: '42P01', message: 'relation "public.organizations" does not exist' }],
  ])('reads %s as an unapplied migration', (_label, error) => {
    expect(interpretEnsureResult(null, error)).toEqual({ status: 'skipped', reason: 'schema_missing' });
  });

  it('reads any other error as failed', () => {
    expect(interpretEnsureResult(null, { code: '57014', message: 'canceling statement due to statement timeout' }))
      .toEqual({ status: 'failed', error: 'canceling statement due to statement timeout' });
  });

  it.each([
    ['null', null],
    ['an array', [{ org_id: ORG, created: true }]],
    ['a non-uuid org id', { org_id: 'nope', created: true }],
    ['a missing created flag', { org_id: ORG }],
    ['an unknown skip reason', { skipped: 'whatever' }],
  ])('refuses %s as an unexpected answer', (_label, data) => {
    expect(interpretEnsureResult(data, null)).toMatchObject({ status: 'failed' });
  });
});

describe('ensurePersonalOrg', () => {
  it('calls the one SQL function with the user id', async () => {
    await ensurePersonalOrg(admin, USER);
    expect(rpcCalls).toEqual([{ fn: ENSURE_PRODUCER_ORG_RPC, args: { p_user: USER } }]);
    expect(ENSURE_PRODUCER_ORG_RPC).toBe('labelos_ensure_producer_org');
  });

  it('records org.created when it made the org', async () => {
    const res = await ensurePersonalOrg(admin, USER);
    expect(res).toEqual({ status: 'created', orgId: ORG });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe('activity_events');
    expect(inserted[0].row).toMatchObject({
      org_id: ORG,
      actor_id: USER,
      verb: 'org.created',
      subject_type: 'org',
      subject_id: ORG,
      audit: false,
      payload: { kind: 'producer', source: 'profile' },
    });
  });

  it('records nothing when the org already existed', async () => {
    rpcResult = { data: { org_id: ORG, created: false }, error: null };
    expect(await ensurePersonalOrg(admin, USER)).toEqual({ status: 'exists', orgId: ORG });
    expect(inserted).toEqual([]);
  });

  it('a failed event write does not fail the org', async () => {
    insertResult = { data: null, error: { message: 'boom' } };
    expect(await ensurePersonalOrg(admin, USER)).toEqual({ status: 'created', orgId: ORG });
    insertResult = new Error('network');
    expect(await ensurePersonalOrg(admin, USER)).toEqual({ status: 'created', orgId: ORG });
  });

  it('skips without calling the database for a non-uuid user (local-store mode)', async () => {
    expect(await ensurePersonalOrg(admin, 'local-user')).toEqual({ status: 'skipped', reason: 'invalid_user' });
    expect(rpcCalls).toEqual([]);
  });

  it('degrades when migrations 136/137 are not applied', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
    expect(await ensurePersonalOrg(admin, USER)).toEqual({ status: 'skipped', reason: 'schema_missing' });
    expect(inserted).toEqual([]);
  });

  it('never throws, even when the client does', async () => {
    rpcResult = new Error('fetch failed');
    expect(await ensurePersonalOrg(admin, USER)).toEqual({ status: 'failed', error: 'fetch failed' });
  });
});
