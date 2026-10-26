import { describe, expect, it } from 'vitest';
import { fakeAdmin, eqs, type Chain } from './mocks/fake-admin';
import { memberIdentities, memberLabel } from './member-identity';

const ORG = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333'; // joined by invitation
const B = '44444444-4444-4444-8444-444444444444'; // the founding producer
const INV = '55555555-5555-4555-8555-555555555555';

function answer(chain: Chain) {
  switch (chain.table) {
    case 'user_profiles':
      return { data: [{ user_id: A, display_name: '  Dana  ' }], error: null };
    case 'creator_profiles':
      return { data: [{ user_id: B, display_name: 'Uche' }, { user_id: A, display_name: 'Ignored' }], error: null };
    case 'activity_events':
      expect(eqs(chain)).toEqual({ org_id: ORG, verb: 'member.joined' });
      return { data: [{ subject_id: A, payload: { invitation_id: INV } }], error: null };
    case 'org_invitations':
      expect(eqs(chain)).toEqual({ org_id: ORG });
      return { data: [{ id: INV, email: 'dana@label.test' }], error: null };
    default:
      return { data: null, error: { message: 'unexpected' } };
  }
}

describe('memberIdentities', () => {
  it('name from the Label OS profile, else the storefront; email from the accepted invitation, else auth', async () => {
    const { client } = fakeAdmin({ answer });
    const authCalls: string[] = [];
    const admin = Object.assign(client, {
      auth: { admin: { getUserById: async (id: string) => { authCalls.push(id); return { data: { user: { email: 'Uche@Studio.test' } }, error: null }; } } },
    });
    const ids = await memberIdentities(admin as never, ORG, [A, B]);
    expect(ids.get(A)).toEqual({ name: 'Dana', email: 'dana@label.test' });
    expect(ids.get(B)).toEqual({ name: 'Uche', email: 'uche@studio.test' });
    expect(authCalls).toEqual([B]);
  });

  it('a failing source leaves that field unknown, never throws', async () => {
    const { client } = fakeAdmin({ answer: () => ({ data: null, error: { message: 'down' } }) });
    const admin = Object.assign(client, { auth: { admin: { getUserById: async () => { throw new Error('no admin api'); } } } });
    const ids = await memberIdentities(admin as never, ORG, [A]);
    expect(ids.get(A)).toEqual({ name: null, email: null });
    expect(memberLabel(ids.get(A))).toBe('Member');
    expect(memberLabel({ name: null, email: 'x@y.z' })).toBe('x@y.z');
  });

  it('no members, no reads', async () => {
    const fake = fakeAdmin({ answer });
    expect((await memberIdentities(fake.client as never, ORG, [])).size).toBe(0);
    expect(fake.chains).toHaveLength(0);
  });
});

describe('memberIdentities without emails', () => {
  it('reads names only: no invitation or auth lookups', async () => {
    const fake = fakeAdmin({ answer });
    let authCalls = 0;
    const admin = Object.assign(fake.client, { auth: { admin: { getUserById: async () => { authCalls += 1; return { data: null, error: null }; } } } });
    const ids = await memberIdentities(admin as never, ORG, [A, B], { withEmail: false });
    expect(ids.get(A)).toEqual({ name: 'Dana', email: null });
    expect(fake.chains.map((c) => c.table).sort()).toEqual(['creator_profiles', 'user_profiles']);
    expect(authCalls).toBe(0);
  });
});
