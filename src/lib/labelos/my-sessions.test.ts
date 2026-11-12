import { describe, expect, it } from 'vitest';
import {
  assembleSessions,
  contractNeedsSigning,
  creditNeedsConfirming,
  splitLineNeedsAcknowledging,
  type SessionAsk,
  type SessionProject,
} from './my-sessions';

const proj = (id: string, orgId: string, orgName: string, name: string): SessionProject => ({ id, orgId, orgName, name, role: 'contributor', href: `/shared/${id}` });
const ask = (key: string, projectId: string): SessionAsk => ({ key, kind: 'credit', projectId, trackId: 't', trackTitle: 'T', label: 'x', refId: key, sheetId: null });

describe('assembleSessions', () => {
  const P = [proj('p1', 'o1', 'Zeta', 'B'), proj('p2', 'o1', 'Zeta', 'A'), proj('p3', 'o2', 'Alpha', 'C')];

  it('groups by org, projects by name', () => {
    const s = assembleSessions(P, []);
    expect(s.map((o) => o.orgName)).toEqual(['Alpha', 'Zeta']);
    expect(s[1].projects.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('lists an ask only under a project the person can open (nothing they could not open one by one)', () => {
    const s = assembleSessions(P, [ask('a', 'p1'), ask('b', 'p-not-theirs')]);
    const all = s.flatMap((o) => o.projects.flatMap((p) => p.asks.map((a) => a.key)));
    expect(all).toEqual(['a']);
  });

  it('every listed project is one of the memberships passed in', () => {
    const s = assembleSessions([P[0]], [ask('a', 'p3')]);
    expect(s.flatMap((o) => o.projects.map((p) => p.id))).toEqual(['p1']);
    expect(s[0].askCount).toBe(0);
  });

  it('counts asks, floats orgs with asks first and ignores a repeated key', () => {
    const s = assembleSessions(P, [ask('a', 'p1'), ask('a', 'p1'), ask('b', 'p2')]);
    expect(s[0].orgName).toBe('Zeta');
    expect(s[0].askCount).toBe(2);
  });

  it('has nothing for nobody', () => {
    expect(assembleSessions([], [ask('a', 'p1')])).toEqual([]);
  });
});

describe('what counts as an ask', () => {
  it('credit: theirs, proposed, proposed by someone else', () => {
    const c = { id: '1', track_id: 't', role: 'producer', status: 'proposed', created_by: 'boss', party_user_id: 'me' };
    expect(creditNeedsConfirming(c, 'me')).toBe(true);
    expect(creditNeedsConfirming({ ...c, created_by: 'me' }, 'me')).toBe(false);
    expect(creditNeedsConfirming({ ...c, status: 'confirmed' }, 'me')).toBe(false);
    expect(creditNeedsConfirming({ ...c, party_user_id: 'other' }, 'me')).toBe(false);
    expect(creditNeedsConfirming({ ...c, party_user_id: null }, 'me')).toBe(false);
  });
  it('split line: theirs, unsigned, circulated sheet', () => {
    const l = { id: '1', sheet_id: 's', track_id: 't', sheet_status: 'circulated', signed_at: null, party_user_id: 'me' };
    expect(splitLineNeedsAcknowledging(l, 'me')).toBe(true);
    for (const bad of [{ sheet_status: 'draft' }, { sheet_status: 'signed' }, { sheet_status: 'superseded' }, { signed_at: '2026-01-01' }, { party_user_id: 'x' }]) {
      expect(splitLineNeedsAcknowledging({ ...l, ...bad }, 'me')).toBe(false);
    }
  });
  it('contract: sent, theirs, not yet signed on the current document', () => {
    const c = { id: '1', title: 'T', status: 'sent', track_id: null, party_user_id: 'me', party_confirmed_by: 'me', party_linked_by: 'boss', signedCurrent: false };
    expect(contractNeedsSigning(c, 'me')).toBe(true);
    expect(contractNeedsSigning({ ...c, signedCurrent: true }, 'me')).toBe(false);
    expect(contractNeedsSigning({ ...c, status: 'draft' }, 'me')).toBe(false);
    expect(contractNeedsSigning({ ...c, status: 'signed' }, 'me')).toBe(false);
    expect(contractNeedsSigning({ ...c, party_user_id: 'x' }, 'me')).toBe(false);
    // The same identity rule as maySignAs: confirmed by them, linked by someone else.
    expect(contractNeedsSigning({ ...c, party_confirmed_by: null }, 'me')).toBe(false);
    expect(contractNeedsSigning({ ...c, party_linked_by: 'me' }, 'me')).toBe(false);
    expect(contractNeedsSigning({ ...c, party_linked_by: null }, 'me')).toBe(false);
  });
});
