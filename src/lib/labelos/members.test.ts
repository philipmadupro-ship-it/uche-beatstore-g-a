import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_LABELS,
  assignableRoles,
  planMemberChange,
  planMemberRemoval,
  switchableCapabilities,
  toggleCapability,
  type MemberState,
} from './members';
import { ALL_CAPABILITIES, capabilitiesFor } from './capabilities';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

const member = (over: Partial<MemberState> = {}): MemberState => ({
  userId: MEMBER,
  role: 'member',
  functions: ['a_and_r'],
  scope: 'org',
  capGrants: [],
  capRevokes: [],
  ...over,
});
const owner = { userId: OWNER, role: 'owner' as const };
const admin = { userId: ADMIN, role: 'admin' as const };

describe('planMemberChange', () => {
  it('an admin changes a member’s functions; capabilities_changed is the event', () => {
    const plan = planMemberChange('label', admin, member(), { functions: ['marketing', 'legal', 'marketing'] }, 1);
    expect(plan).toEqual({
      ok: true,
      noop: false,
      patch: { functions: ['marketing', 'legal'] },
      event: {
        verb: 'member.capabilities_changed',
        payload: { functions: { from: ['a_and_r'], to: ['marketing', 'legal'] } },
      },
    });
  });

  it('the same values are a no-op with no events', () => {
    const plan = planMemberChange('label', admin, member(), { functions: ['a_and_r'], role: 'member', scope: 'org' }, 1);
    expect(plan).toEqual({ ok: true, noop: true, patch: {}, event: null });
  });

  it('refuses functions the org kind does not offer, and unknown ones', () => {
    expect(planMemberChange('producer', admin, member({ functions: [] }), { functions: ['a_and_r'] }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member(), { functions: ['dj'] }, 1)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses roles the kind does not offer', () => {
    expect(planMemberChange('producer', admin, member(), { role: 'artist' }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member(), { role: 'boss' }, 1)).toMatchObject({ ok: false, status: 400 });
  });

  it('nobody is made owner here: ownership is transferred, not assigned', () => {
    expect(planMemberChange('label', owner, member(), { role: 'owner' }, 1)).toMatchObject({ ok: false, status: 400 });
  });

  it('a role change is ONE role_changed event naming everything it cleared', () => {
    const plan = planMemberChange('label', admin, member({ capGrants: ['contracts.read'] }), { role: 'admin' }, 1);
    expect(plan).toEqual({
      ok: true,
      noop: false,
      patch: { role: 'admin', functions: [], cap_grants: [] },
      event: {
        verb: 'member.role_changed',
        payload: {
          role: { from: 'member', to: 'admin' },
          functions: { from: ['a_and_r'], to: [] },
          cap_grants: { from: ['contracts.read'], to: [] },
        },
      },
    });
  });

  it('a scope change alone is member.scope_changed', () => {
    const plan = planMemberChange('label', admin, member(), { scope: 'artists' }, 1);
    expect(plan).toMatchObject({ ok: true, patch: { scope: 'artists' }, event: { verb: 'member.scope_changed', payload: { scope: { from: 'org', to: 'artists' } } } });
  });

  it('functions are refused for a role that does not take them', () => {
    expect(planMemberChange('label', admin, member(), { role: 'admin', functions: ['legal'] }, 1)).toMatchObject({ ok: false, status: 400 });
  });

  it('role artist is always artist-scoped; admins are never artist-scoped', () => {
    const toArtist = planMemberChange('label', admin, member(), { role: 'artist' }, 1);
    expect(toArtist).toMatchObject({ ok: true, patch: { role: 'artist', scope: 'artists', functions: [] } });
    if (!toArtist.ok) throw new Error('unreachable');
    expect(toArtist.event?.verb).toBe('member.role_changed');
    expect(Object.keys(toArtist.event?.payload ?? {})).toEqual(['role', 'functions', 'scope']);
    expect(planMemberChange('label', admin, member(), { role: 'artist', scope: 'org' }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member(), { role: 'admin', scope: 'artists' }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member({ scope: 'artists' }), { role: 'admin' }, 1)).toMatchObject({
      ok: true,
      patch: { role: 'admin', scope: 'org' },
    });
  });

  it('only an owner touches an owner row', () => {
    const target = member({ userId: OWNER, role: 'owner', functions: [] });
    expect(planMemberChange('label', admin, target, { role: 'admin' }, 2)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberChange('label', { userId: 'x', role: 'owner' }, target, { role: 'admin' }, 2)).toMatchObject({ ok: true });
  });

  it('the last owner can never be demoted (409)', () => {
    const target = member({ userId: OWNER, role: 'owner', functions: [] });
    expect(planMemberChange('label', owner, target, { role: 'admin' }, 1)).toMatchObject({ ok: false, status: 409 });
    expect(planMemberChange('label', owner, target, { role: 'admin' }, 2)).toMatchObject({ ok: true });
  });

  it('a member cannot raise their own role or abilities, but may lower them', () => {
    const self = { userId: ADMIN, role: 'admin' as const };
    const target = member({ userId: ADMIN, role: 'admin', functions: [] });
    expect(planMemberChange('label', self, target, { role: 'member' }, 1)).toMatchObject({ ok: true });
    // A member with members.manage does not exist (NEVER_GRANTABLE), but the
    // rule holds on its own terms.
    const selfMember = { userId: MEMBER, role: 'member' as const };
    expect(planMemberChange('label', selfMember, member(), { role: 'admin' }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberChange('label', selfMember, member(), { functions: ['a_and_r', 'legal'] }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberChange('label', selfMember, member(), { cap_grants: ['finance.read'] }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberChange('label', selfMember, member({ capRevokes: ['review.write'] }), { cap_revokes: [] }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberChange('label', selfMember, member(), { functions: [] }, 1)).toMatchObject({ ok: true });
  });

  it('stepping down from admin to member with a function is not a raise', () => {
    const self = { userId: ADMIN, role: 'admin' as const };
    const target = member({ userId: ADMIN, role: 'admin', functions: [] });
    expect(planMemberChange('label', self, target, { role: 'member', functions: ['legal'] }, 1)).toMatchObject({ ok: true });
  });

  it('per-member switches: never-grantable and unknown capabilities are refused; revoke wins', () => {
    expect(planMemberChange('label', admin, member(), { cap_grants: ['members.manage'] }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member(), { cap_grants: ['sudo'] }, 1)).toMatchObject({ ok: false, status: 400 });
    expect(
      planMemberChange('label', admin, member({ role: 'artist', scope: 'artists', functions: [] }), { cap_grants: ['contracts.read'] }, 1),
    ).toMatchObject({ ok: false, status: 400 });
    expect(planMemberChange('label', admin, member(), { cap_grants: ['finance.read', 'legal' as never] }, 1)).toMatchObject({ ok: false });
    const both = planMemberChange('label', admin, member(), { cap_grants: ['finance.read'], cap_revokes: ['finance.read'] }, 1);
    expect(both).toMatchObject({ ok: true, patch: { cap_revokes: ['finance.read'] } });
    if (!both.ok) throw new Error('unreachable');
    expect(both.patch.cap_grants).toBeUndefined();
  });

  it('owner and admin take no switches', () => {
    expect(planMemberChange('label', owner, member({ userId: ADMIN, role: 'admin', functions: [] }), { cap_revokes: ['catalog.read'] }, 1)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('planMemberRemoval', () => {
  it('removes a member', () => {
    expect(planMemberRemoval(admin, member(), 1)).toEqual({ ok: true });
  });
  it('an admin cannot remove an owner; the last owner is never removed', () => {
    const target = member({ userId: OWNER, role: 'owner', functions: [] });
    expect(planMemberRemoval(admin, target, 2)).toMatchObject({ ok: false, status: 403 });
    expect(planMemberRemoval(owner, target, 1)).toMatchObject({ ok: false, status: 409 });
    expect(planMemberRemoval({ userId: 'x', role: 'owner' }, target, 2)).toEqual({ ok: true });
  });
});

describe('switches', () => {
  it('switchable capabilities exclude the never-grantable ones, and none for owner/admin', () => {
    expect(switchableCapabilities('label', 'admin')).toEqual([]);
    const m = switchableCapabilities('label', 'member');
    expect(m).not.toContain('members.manage');
    expect(m).not.toContain('org.manage');
    expect(switchableCapabilities('label', 'artist')).not.toContain('contracts.read');
  });

  it('every capability has a label', () => {
    for (const cap of ALL_CAPABILITIES) expect(CAPABILITY_LABELS[cap]).toBeTruthy();
  });

  it('switching off a preset capability revokes it, and switching it back on clears the revoke', () => {
    const off = toggleCapability('label', 'member', ['a_and_r'], { grant: [], revoke: [] }, 'review.write', false);
    expect(off).toEqual({ grant: [], revoke: ['review.write'] });
    expect(capabilitiesFor('label', 'member', ['a_and_r'], off).has('review.write')).toBe(false);
    const on = toggleCapability('label', 'member', ['a_and_r'], off, 'review.write', true);
    expect(on).toEqual({ grant: [], revoke: [] });
  });

  it('switching on a capability outside the preset grants it; off again removes the grant', () => {
    const on = toggleCapability('label', 'member', ['marketing'], { grant: [], revoke: [] }, 'audio.working', true);
    expect(on).toEqual({ grant: ['audio.working'], revoke: [] });
    expect(toggleCapability('label', 'member', ['marketing'], on, 'audio.working', false)).toEqual({ grant: [], revoke: [] });
  });

  it('switching on something whose read was revoked clears that revoke too', () => {
    const noCatalog = toggleCapability('label', 'member', ['a_and_r'], { grant: [], revoke: [] }, 'catalog.read', false);
    expect(capabilitiesFor('label', 'member', ['a_and_r'], noCatalog).has('catalog.write')).toBe(false);
    const back = toggleCapability('label', 'member', ['a_and_r'], noCatalog, 'catalog.write', true);
    expect(capabilitiesFor('label', 'member', ['a_and_r'], back).has('catalog.write')).toBe(true);
    expect(back.revoke).not.toContain('catalog.read');
  });

  it('switching off a capability removes grants that need it', () => {
    const granted = toggleCapability('label', 'member', [], { grant: [], revoke: [] }, 'catalog.write', true);
    const off = toggleCapability('label', 'member', [], granted, 'catalog.read', false);
    expect(capabilitiesFor('label', 'member', [], off).has('catalog.write')).toBe(false);
    expect(off.grant).toEqual([]);
  });
});

describe('assignableRoles', () => {
  it('offers what the route would accept, plus the current role', () => {
    expect(assignableRoles('label', admin, member(), 1)).toEqual(['admin', 'member', 'artist']);
    expect(assignableRoles('producer', admin, member(), 1)).toEqual(['admin', 'member']);
    // An admin looking at an owner: only the owner's own role.
    expect(assignableRoles('label', admin, member({ userId: OWNER, role: 'owner', functions: [] }), 2)).toEqual(['owner']);
    // The last owner looking at themselves: nothing to change to.
    expect(assignableRoles('label', owner, member({ userId: OWNER, role: 'owner', functions: [] }), 1)).toEqual(['owner']);
    expect(assignableRoles('label', owner, member({ userId: OWNER, role: 'owner', functions: [] }), 2)).toEqual(['owner', 'admin', 'member', 'artist']);
  });
});
