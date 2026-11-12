import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN,
  generatePassword,
  interpretCreate,
  isEmailTaken,
  isMissingTeamAccounts,
  passwordGateExempt,
  passwordProblem,
  sessionIdOf,
  targetRefusal,
  toManagedView,
} from './team-accounts';

describe('passwordProblem', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('blue-river-42-Stone')).toBeNull();
  });
  it('refuses short, long, padded, control-character and repetitive ones', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN - 1))).toMatch(/at least/);
    expect(passwordProblem('ab'.repeat(65))).toMatch(/at most/);
    expect(passwordProblem(' padded-password ')).toMatch(/space/);
    expect(passwordProblem('bad\u0000password-x')).toMatch(/control/);
    expect(passwordProblem('aaaaaaaaaaaaab')).toMatch(/repetitive/);
    expect(passwordProblem(undefined)).toMatch(/Enter/);
  });
  it('refuses a password that contains the email name', () => {
    expect(passwordProblem('marketing2026!x', 'marketing@label.com')).toMatch(/email/);
    // A very short local part is not a meaningful match.
    expect(passwordProblem('a-strong-pass-77', 'a@label.com')).toBeNull();
  });
});

describe('generatePassword', () => {
  it('makes four groups of four from an alphabet without look-alikes, and passes its own policy', () => {
    const fixed = (n: number) => Uint32Array.from({ length: n }, (_, i) => i * 7 + 3);
    const pw = generatePassword(fixed);
    expect(pw).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
    expect(pw).not.toMatch(/[01lIoO]/);
    expect(passwordProblem(pw)).toBeNull();
  });
});

describe('interpretCreate', () => {
  it('maps the function answers', () => {
    expect(interpretCreate({ ok: true })).toEqual({ ok: true });
    expect(interpretCreate({ error: 'seat_limit' })).toMatchObject({ ok: false, status: 409, code: 'seat_limit' });
    expect(interpretCreate({ error: 'already_member' })).toMatchObject({ ok: false, status: 409 });
    expect(interpretCreate({ error: 'bad_role' })).toMatchObject({ ok: false, status: 400 });
  });
  it('anything else is unknown (the route throws)', () => {
    expect(interpretCreate(null)).toBeNull();
    expect(interpretCreate({ error: 'surprise' })).toBeNull();
  });
});

describe('targetRefusal', () => {
  it('an account the org did not create looks like one that does not exist', () => {
    expect(targetRefusal('not_managed')).toMatchObject({ status: 404 });
    expect(targetRefusal('not_member')).toMatchObject({ status: 404 });
  });
  it('the other refusals', () => {
    expect(targetRefusal('self')).toMatchObject({ status: 409 });
    expect(targetRefusal('owner_only')).toMatchObject({ status: 403 });
    expect(targetRefusal('shared')).toMatchObject({ status: 409 });
    expect(targetRefusal(undefined)).toBeNull();
  });
});

describe('isEmailTaken / isMissingTeamAccounts', () => {
  it('recognises an address that already has an account', () => {
    expect(isEmailTaken({ code: 'email_exists', message: '' })).toBe(true);
    expect(isEmailTaken({ message: 'A user with this email address has already been registered' })).toBe(true);
    expect(isEmailTaken({ message: 'Database error creating new user' })).toBe(false);
    expect(isEmailTaken(null)).toBe(false);
  });
  it('recognises migration 190 missing, and only that', () => {
    expect(isMissingTeamAccounts({ code: 'PGRST202', message: 'Could not find the function public.labelos_audit_team_account_create' })).toBe(true);
    expect(isMissingTeamAccounts({ code: '42P01', message: 'relation "public.org_managed_accounts" does not exist' })).toBe(true);
    expect(isMissingTeamAccounts({ code: 'PGRST202', message: 'Could not find the function public.something_else' })).toBe(false);
    expect(isMissingTeamAccounts(null)).toBe(false);
  });
});

describe('toManagedView', () => {
  it('shows state, never a secret', () => {
    const view = toManagedView({ user_id: 'u', must_change_password: true, disabled_at: null, created_at: '2026-10-17T00:00:00Z' });
    expect(view).toEqual({ pending_password_change: true, disabled: false, created_at: '2026-10-17T00:00:00Z' });
  });
});

describe('sessionIdOf (keep this session, end the others)', () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  it('reads the session_id claim of an access token', () => {
    expect(sessionIdOf(token({ sub: 'u', session_id: '55555555-5555-4555-8555-555555555555' }))).toBe('55555555-5555-4555-8555-555555555555');
  });
  it('anything else is null, so every session ends', () => {
    expect(sessionIdOf(undefined)).toBeNull();
    expect(sessionIdOf('not-a-jwt')).toBeNull();
    expect(sessionIdOf(token({ sub: 'u' }))).toBeNull();
    expect(sessionIdOf(token({ session_id: "x'; drop" }))).toBeNull();
  });
});

describe('passwordGateExempt', () => {
  it('only saving one’s own password', () => {
    expect(passwordGateExempt('/api/org/account/password', 'POST')).toBe(true);
    expect(passwordGateExempt('/api/org/account/password', 'GET')).toBe(false);
    expect(passwordGateExempt('/api/org/account/password/x', 'POST')).toBe(false);
    expect(passwordGateExempt('/api/org', 'POST')).toBe(false);
  });
});
