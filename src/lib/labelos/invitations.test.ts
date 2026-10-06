import { describe, expect, it } from 'vitest';
import {
  INVITATION_TTL_MS,
  ACCEPT_INVITATION_RPC,
  buildInvitationEmail,
  hashInvitationToken,
  interpretAcceptResult,
  invitableFunctions,
  invitableRoles,
  invitationState,
  isWellFormedInvitationToken,
  joinStep,
  newInvitationToken,
  validateInvitationGrant,
} from './invitations';

describe('tokens', () => {
  it('mints 32 random bytes as base64url and stores only the sha-256', () => {
    const a = newInvitationToken();
    const b = newInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashInvitationToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it('hashes deterministically (sha-256 hex)', () => {
    expect(hashInvitationToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('recognises only well-formed tokens', () => {
    expect(isWellFormedInvitationToken(newInvitationToken().token)).toBe(true);
    for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, null, 42]) {
      expect(isWellFormedInvitationToken(bad), String(bad)).toBe(false);
    }
  });

  it('expires after 7 days', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('names the accept function of migration 138', () => {
    expect(ACCEPT_INVITATION_RPC).toBe('labelos_accept_invitation');
  });
});

describe('what each org kind can invite (06 §2.4b)', () => {
  it('never offers owner: ownership is transferred, not invited', () => {
    expect(invitableRoles('label')).toEqual(['admin', 'member', 'artist']);
    expect(invitableRoles('producer')).toEqual(['admin', 'member']);
    expect(invitableRoles('artist')).toEqual(['admin', 'member']);
  });

  it('offers the functions of the kind', () => {
    expect(invitableFunctions('producer')).toEqual(['producer', 'engineer', 'artist_manager', 'operations']);
    expect(invitableFunctions('label')).toContain('a_and_r');
    expect(invitableFunctions('artist')).not.toContain('a_and_r');
  });
});

describe('validateInvitationGrant', () => {
  const C1 = '11111111-1111-4111-8111-111111111111';

  it('accepts a member with functions the kind offers, org-scoped', () => {
    expect(validateInvitationGrant('label', { role: 'member', functions: ['a_and_r', 'marketing'], contactIds: [] })).toEqual({
      ok: true,
      role: 'member',
      functions: ['a_and_r', 'marketing'],
      contactIds: [],
      scope: 'org',
    });
  });

  it('dedupes functions and contacts, keeping order', () => {
    const r = validateInvitationGrant('label', { role: 'member', functions: ['legal', 'legal'], contactIds: [C1, C1] });
    expect(r).toMatchObject({ ok: true, functions: ['legal'], contactIds: [C1], scope: 'artists' });
  });

  it('scopes an artist to artists always (org_members CHECK)', () => {
    expect(validateInvitationGrant('label', { role: 'artist', functions: [], contactIds: [] })).toMatchObject({ ok: true, scope: 'artists' });
  });

  it('refuses owner', () => {
    expect(validateInvitationGrant('label', { role: 'owner', functions: [], contactIds: [] })).toMatchObject({ ok: false });
  });

  it('refuses a role the kind does not offer', () => {
    const r = validateInvitationGrant('producer', { role: 'artist', functions: [], contactIds: [] });
    expect(r).toEqual({ ok: false, error: 'A producer organization cannot invite the role "artist"' });
  });

  it('refuses a function the kind does not offer', () => {
    const r = validateInvitationGrant('producer', { role: 'member', functions: ['a_and_r'], contactIds: [] });
    expect(r).toEqual({ ok: false, error: 'A producer organization does not offer the function "a_and_r"' });
  });

  it('refuses unknown roles and functions', () => {
    expect(validateInvitationGrant('label', { role: 'god', functions: [], contactIds: [] }).ok).toBe(false);
    expect(validateInvitationGrant('label', { role: 'member', functions: ['ceo'], contactIds: [] }).ok).toBe(false);
  });

  it('refuses functions on a role that does not take them', () => {
    for (const role of ['admin', 'artist']) {
      const r = validateInvitationGrant('label', { role, functions: ['legal'], contactIds: [] });
      expect(r, role).toEqual({ ok: false, error: `The ${role} role does not take functions` });
    }
  });

  it('refuses an admin limited to some artists (admins run the whole org)', () => {
    const r = validateInvitationGrant('label', { role: 'admin', functions: [], contactIds: [C1] });
    expect(r).toEqual({ ok: false, error: 'An admin cannot be limited to some artists' });
  });
});

describe('invitationState', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const base = { expires_at: '2026-10-08T12:00:00Z', accepted_at: null, revoked_at: null };

  it('pending → accepted / revoked / expired', () => {
    expect(invitationState(base, now)).toBe('pending');
    expect(invitationState({ ...base, accepted_at: '2026-10-01T00:00:00Z' }, now)).toBe('accepted');
    expect(invitationState({ ...base, revoked_at: '2026-10-01T00:00:00Z' }, now)).toBe('revoked');
    expect(invitationState({ ...base, expires_at: '2026-10-01T12:00:00Z' }, now)).toBe('expired');
  });

  it('revoked wins over accepted and expired; accepted wins over expired', () => {
    expect(invitationState({ expires_at: '2020-01-01T00:00:00Z', accepted_at: 'x', revoked_at: 'y' }, now)).toBe('revoked');
    expect(invitationState({ expires_at: '2020-01-01T00:00:00Z', accepted_at: 'x', revoked_at: null }, now)).toBe('accepted');
  });

  it('an unreadable expiry is expired (fail closed)', () => {
    expect(invitationState({ ...base, expires_at: 'nonsense' }, now)).toBe('expired');
  });
});

describe('interpretAcceptResult', () => {
  const ORG = '22222222-2222-4222-8222-222222222222';

  it('joined', () => {
    expect(interpretAcceptResult({ status: 'joined', org_id: ORG }, null)).toEqual({ ok: true, orgId: ORG, projectId: null, alreadyMember: false });
  });

  it('accepting twice is idempotent', () => {
    expect(interpretAcceptResult({ status: 'already_member', org_id: ORG }, null)).toEqual({ ok: true, orgId: ORG, projectId: null, alreadyMember: true });
    // A project invitation answers with the project (LABEL-21).
    const PROJECT = '99999999-9999-4999-8999-999999999999';
    expect(interpretAcceptResult({ status: 'joined', org_id: ORG, project_id: PROJECT }, null)).toEqual({ ok: true, orgId: ORG, projectId: PROJECT, alreadyMember: false });
    expect(interpretAcceptResult({ status: 'joined', org_id: ORG, project_id: 'nope' }, null)).toMatchObject({ projectId: null });
  });

  it.each([
    ['not_found', 404],
    ['email_mismatch', 403],
    ['email_unverified', 403],
    ['revoked', 410],
    ['expired', 410],
    ['used', 409],
    ['unsupported', 404],
  ])('%s → %i', (code, status) => {
    const r = interpretAcceptResult({ error: code }, null);
    expect(r).toMatchObject({ ok: false, status, code });
  });

  it('never names the invited email on a mismatch', () => {
    const r = interpretAcceptResult({ error: 'email_mismatch' }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/@/);
  });

  it('a missing function (138 not applied) is 503, a db error 500, garbage 500', () => {
    expect(interpretAcceptResult(null, { code: 'PGRST202', message: 'not in schema cache' })).toMatchObject({ ok: false, status: 503 });
    expect(interpretAcceptResult(null, { code: 'XX000', message: 'boom' })).toMatchObject({ ok: false, status: 500 });
    expect(interpretAcceptResult({ status: 'joined', org_id: 'nope' }, null)).toMatchObject({ ok: false, status: 500 });
    expect(interpretAcceptResult('x', null)).toMatchObject({ ok: false, status: 500 });
  });
});

describe('buildInvitationEmail', () => {
  const mail = buildInvitationEmail({
    orgName: 'Night <Shift> & Co',
    inviterName: 'Uche',
    role: 'member',
    functions: ['a_and_r'],
    url: 'https://app.test/join/TOKEN',
  });

  it('escapes the org name and links the join page', () => {
    expect(mail.subject).toBe('Uche invited you to Night <Shift> & Co');
    expect(mail.html).toContain('Night &lt;Shift&gt; &amp; Co');
    expect(mail.html).not.toContain('<Shift>');
    expect(mail.html).toContain('href="https://app.test/join/TOKEN"');
    expect(mail.text).toContain('https://app.test/join/TOKEN');
    expect(mail.text).toContain('A&R');
  });

  it('puts dark text on the light button (R-22)', () => {
    const button = mail.html.match(/<a [^>]*>/)![0];
    expect(button).toMatch(/background-color:#FFFFFF/i);
    expect(button).toMatch(/[^-]color:#090907/i);
  });

  it('names only the org when the inviter has no name', () => {
    const m = buildInvitationEmail({ orgName: 'L', inviterName: null, role: 'artist', functions: [], url: 'https://x/join/t' });
    expect(m.subject).toBe("You're invited to L");
    expect(m.text).toMatch(/^You have been invited to join L as Artist\./);
  });

  it('says when the link expires', () => {
    expect(mail.text).toMatch(/7 days/);
  });
});

describe('joinStep', () => {
  const p = (over: Partial<Parameters<typeof joinStep>[0]> = {}) => ({
    org: { name: 'L', kind: 'label' },
    role: 'member',
    functions: [],
    state: 'pending' as const,
    signedIn: true,
    emailMatches: true,
    member: false,
    ...over,
  });

  it('walks pending → sign in → right account → ready', () => {
    expect(joinStep(p({ signedIn: false, emailMatches: null }))).toBe('sign_in');
    expect(joinStep(p({ emailMatches: false }))).toBe('wrong_account');
    expect(joinStep(p())).toBe('ready');
  });

  it('a member is sent to the org whatever the link state', () => {
    expect(joinStep(p({ member: true, state: 'accepted' }))).toBe('member');
    expect(joinStep(p({ member: true, state: 'expired' }))).toBe('member');
  });

  it('a dead link says so before asking anyone to sign in', () => {
    expect(joinStep(p({ state: 'revoked', signedIn: false }))).toBe('revoked');
    expect(joinStep(p({ state: 'expired', signedIn: false }))).toBe('expired');
    expect(joinStep(p({ state: 'accepted', signedIn: false }))).toBe('used');
  });
});
