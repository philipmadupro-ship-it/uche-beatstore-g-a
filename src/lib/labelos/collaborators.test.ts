import { describe, expect, it } from 'vitest';
import { CREDIT_ROLES, resolveCreditScope } from './credit-roles';
import {
  COLLABORATOR_ROLES,
  COLLABORATOR_ROLE_DEFS,
  checkCollaboratorInvite,
  encodeCollaboratorIntent,
  parseCollaboratorIntent,
  planAcceptCredit,
} from './collaborators';

const SONG = '11111111-1111-4111-8111-111111111111';

describe('collaborator roles', () => {
  it('every role maps to a real credit role', () => {
    const known = new Set(CREDIT_ROLES.map((r) => r.key));
    for (const r of COLLABORATOR_ROLES) {
      expect(known.has(COLLABORATOR_ROLE_DEFS[r].creditRole), r).toBe(true);
      expect(resolveCreditScope(COLLABORATOR_ROLE_DEFS[r].creditRole).ok).toBe(true);
    }
  });
});

describe('invitation intent tags', () => {
  it('round-trips', () => {
    expect(parseCollaboratorIntent(encodeCollaboratorIntent('rapper', SONG))).toEqual({ role: 'rapper', songId: SONG });
  });
  it('lower-cases the song id', () => {
    expect(parseCollaboratorIntent(encodeCollaboratorIntent('feature', SONG.toUpperCase()))?.songId).toBe(SONG);
  });
  it.each([
    [null],
    [[]],
    [['collab:rapper']],
    [[`song:${SONG}`]],
    [['collab:drummer', `song:${SONG}`]],
    [['collab:rapper', 'song:nope']],
    [['a_and_r']],
  ])('is no intent for %j', (fns) => {
    expect(parseCollaboratorIntent(fns as string[] | null)).toBeNull();
  });
});

describe('checkCollaboratorInvite', () => {
  it('no collaborator fields is an ordinary invitation, whoever sends it', () => {
    expect(checkCollaboratorInvite({ collaboratorRole: undefined, songId: undefined, inviterCanWriteRights: false })).toEqual({ ok: true, intent: null });
  });
  it('needs both fields', () => {
    expect(checkCollaboratorInvite({ collaboratorRole: 'rapper', songId: undefined, inviterCanWriteRights: true })).toMatchObject({ ok: false, status: 400 });
    expect(checkCollaboratorInvite({ collaboratorRole: undefined, songId: SONG, inviterCanWriteRights: true })).toMatchObject({ ok: false, status: 400 });
  });
  it('refuses an unknown role and a bad song id', () => {
    expect(checkCollaboratorInvite({ collaboratorRole: 'drummer', songId: SONG, inviterCanWriteRights: true })).toMatchObject({ ok: false, status: 400 });
    expect(checkCollaboratorInvite({ collaboratorRole: 'rapper', songId: 'x', inviterCanWriteRights: true })).toMatchObject({ ok: false, status: 400 });
  });
  it('is 403 without rights.write', () => {
    expect(checkCollaboratorInvite({ collaboratorRole: 'rapper', songId: SONG, inviterCanWriteRights: false })).toMatchObject({ ok: false, status: 403 });
  });
  it('accepts a complete request', () => {
    expect(checkCollaboratorInvite({ collaboratorRole: 'engineer', songId: SONG, inviterCanWriteRights: true })).toEqual({
      ok: true,
      intent: { role: 'engineer', songId: SONG },
    });
  });
});

describe('planAcceptCredit', () => {
  const intent = { role: 'beatmaker' as const, songId: SONG };
  it('proposes the matching credit in the inviter’s name', () => {
    expect(planAcceptCredit({ intent, inviterId: 'u1', inviterCanWriteRights: true, songInProject: true })).toEqual({
      ok: true,
      creditRole: 'producer',
      roleDetail: 'Beat',
      createdBy: 'u1',
    });
  });
  it('does nothing without an intent, when the inviter lost rights or left, or the song moved', () => {
    expect(planAcceptCredit({ intent: null, inviterId: 'u1', inviterCanWriteRights: true, songInProject: true })).toEqual({ ok: false, reason: 'no_intent' });
    expect(planAcceptCredit({ intent, inviterId: 'u1', inviterCanWriteRights: false, songInProject: true })).toEqual({ ok: false, reason: 'inviter_gone' });
    expect(planAcceptCredit({ intent, inviterId: null, inviterCanWriteRights: true, songInProject: true })).toEqual({ ok: false, reason: 'inviter_gone' });
    expect(planAcceptCredit({ intent, inviterId: 'u1', inviterCanWriteRights: true, songInProject: false })).toEqual({ ok: false, reason: 'song_not_in_project' });
  });
});
