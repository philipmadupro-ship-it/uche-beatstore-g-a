import { describe, expect, it } from 'vitest';
import { adminSections, atLimit, mayOpenAdminCentre, summarizeTeam, usageLine, TEAM_VERBS } from './admin-centre';
import { AUDIT_VERBS, DEFAULT_VISIBILITY } from './activity';

const ADMIN = ['members.manage', 'org.manage', 'catalog.read', 'business.read.internal'];

describe('mayOpenAdminCentre', () => {
  it('label and artist orgs, for whoever manages members', () => {
    expect(mayOpenAdminCentre({ role: 'admin', orgKind: 'label', capabilities: ADMIN })).toBe(true);
    expect(mayOpenAdminCentre({ role: 'owner', orgKind: 'artist', capabilities: new Set(ADMIN) })).toBe(true);
  });
  it('never a producer org, never without members.manage', () => {
    expect(mayOpenAdminCentre({ role: 'owner', orgKind: 'producer', capabilities: ADMIN })).toBe(false);
    expect(mayOpenAdminCentre({ role: 'member', orgKind: 'label', capabilities: ['catalog.read', 'business.read.internal'] })).toBe(false);
  });
});

describe('adminSections', () => {
  it('an owner gets every section, in page order, linking to the pages that own the change', () => {
    const s = adminSections({ role: 'owner', orgKind: 'label', capabilities: ADMIN }, 'north');
    expect(s.map((x) => [x.key, x.href])).toEqual([
      ['team', '/o/north/settings/members'],
      ['roster', '/o/north/artists'],
      ['connections', '/o/north/settings/connections'],
      ['settings', '/o/north/settings/organization'],
      ['digest', '/o/north/settings/digest'],
      ['data', '/o/north/settings/data'],
    ]);
  });
  it('an admin is not shown the owner-only pages', () => {
    const keys = adminSections({ role: 'admin', orgKind: 'label', capabilities: ADMIN }, 'north').map((x) => x.key);
    expect(keys).toEqual(['team', 'roster', 'connections', 'digest']);
  });
  it('an unlicensed digest is left out; an artist org says collaborators', () => {
    const s = adminSections({ role: 'owner', orgKind: 'artist', capabilities: ADMIN, modules: ['catalog'] }, 'me');
    expect(s.map((x) => x.key)).not.toContain('digest');
    expect(s.find((x) => x.key === 'roster')?.label).toBe('Your collaborators');
  });
  it('nothing for someone who may not open the centre', () => {
    expect(adminSections({ role: 'member', orgKind: 'label', capabilities: ['catalog.read'] }, 'x')).toEqual([]);
  });
});

describe('summarizeTeam', () => {
  it('counts roles, team accounts and what they wait on', () => {
    const t = summarizeTeam(
      [{ role: 'owner' }, { role: 'admin' }, { role: 'member' }, { role: 'member' }, { role: 'artist' }],
      [
        { must_change_password: true, disabled_at: null },
        { must_change_password: true, disabled_at: '2026-10-18T00:00:00Z' },
        { must_change_password: false, disabled_at: null },
      ],
      2,
    );
    expect(t).toEqual({ members: 5, owners: 1, admins: 1, staff: 2, artistLogins: 1, teamAccounts: 3, mustSetPassword: 1, switchedOff: 1, pendingInvitations: 2 });
  });
});

describe('usage wording', () => {
  const seats = { one: 'seat', many: 'seats' };
  it('names the cap, or says there is none', () => {
    expect(usageLine(3, 5, seats)).toBe('3 of 5 seats');
    expect(usageLine(1, null, seats)).toBe('1 seat · no limit');
    expect(usageLine(0, 1, seats)).toBe('0 of 1 seat');
  });
  it('at the limit only with a cap', () => {
    expect(atLimit(5, 5)).toBe(true);
    expect(atLimit(4, 5)).toBe(false);
    expect(atLimit(99, null)).toBe(false);
  });
});

describe('TEAM_VERBS', () => {
  it('are all internal, so the list never needs a per-artist filter', () => {
    for (const v of TEAM_VERBS) expect(DEFAULT_VISIBILITY[v], v).toBe('internal');
  });
  it('include every member and invitation audit verb', () => {
    for (const v of AUDIT_VERBS) if (v.startsWith('member.') || v.startsWith('invitation.')) expect(TEAM_VERBS, v).toContain(v);
  });
});
