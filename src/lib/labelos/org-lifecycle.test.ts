import { describe, expect, it } from 'vitest';
import {
  GRACE_DAYS,
  REAUTH_WINDOW_MINUTES,
  canDeleteOrgKind,
  canRestore,
  confirmationMatches,
  graceDaysLeft,
  isFreshSignIn,
  isPurgeDue,
  purgeAfter,
  purgeCutoff,
  retentionCutoff,
} from './org-lifecycle';

const NOW = new Date('2026-10-13T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('re-authentication', () => {
  it('accepts a sign-in inside the window and refuses outside, missing or garbled', () => {
    expect(isFreshSignIn(ago(60_000), NOW)).toBe(true);
    expect(isFreshSignIn(ago(REAUTH_WINDOW_MINUTES * 60_000), NOW)).toBe(true);
    expect(isFreshSignIn(ago(REAUTH_WINDOW_MINUTES * 60_000 + 1000), NOW)).toBe(false);
    expect(isFreshSignIn(null, NOW)).toBe(false);
    expect(isFreshSignIn(undefined, NOW)).toBe(false);
    expect(isFreshSignIn('yesterday', NOW)).toBe(false);
  });

  it('does not trust a sign-in dated well into the future', () => {
    expect(isFreshSignIn(ago(-30_000), NOW)).toBe(true);
    expect(isFreshSignIn(ago(-3_600_000), NOW)).toBe(false);
  });
});

describe('grace period (D10)', () => {
  const deleted = '2026-09-20T12:00:00Z';

  it('is 30 days', () => {
    expect(GRACE_DAYS).toBe(30);
    expect(purgeAfter(deleted)?.toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });

  it('is due exactly when the grace period ends, never before, never for a live org', () => {
    expect(isPurgeDue(deleted, new Date('2026-10-20T11:59:59Z'))).toBe(false);
    expect(isPurgeDue(deleted, new Date('2026-10-20T12:00:00Z'))).toBe(true);
    expect(isPurgeDue(null, NOW)).toBe(false);
    expect(isPurgeDue('nonsense', NOW)).toBe(false);
  });

  it('can be restored until it is due, and only if it is deleted', () => {
    expect(canRestore(deleted, NOW)).toBe(true);
    expect(canRestore(deleted, new Date('2026-10-21T00:00:00Z'))).toBe(false);
    expect(canRestore(null, NOW)).toBe(false);
  });

  it('counts the days left, rounded up and never negative', () => {
    expect(graceDaysLeft(deleted, NOW)).toBe(7);
    expect(graceDaysLeft('2026-10-13T11:00:00Z', NOW)).toBe(30);
    expect(graceDaysLeft('2026-01-01T00:00:00Z', NOW)).toBe(0);
  });

  it('purgeCutoff is the deleted_at an org must be at or before to be due', () => {
    expect(purgeCutoff(NOW).toISOString()).toBe('2026-09-13T12:00:00.000Z');
  });
});

describe('event retention (D9)', () => {
  it('is 24 calendar months back', () => {
    expect(retentionCutoff(NOW).toISOString()).toBe('2024-10-13T12:00:00.000Z');
  });

  it('clamps a day the earlier month does not have', () => {
    expect(retentionCutoff(new Date('2026-02-28T00:00:00Z')).toISOString()).toBe('2024-02-28T00:00:00.000Z');
    expect(retentionCutoff(new Date('2028-02-29T00:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('typed confirmation', () => {
  it('needs the org name, ignoring stray whitespace but not case', () => {
    expect(confirmationMatches('Night Shift', 'Night Shift')).toBe(true);
    expect(confirmationMatches('  Night   Shift ', 'Night Shift')).toBe(true);
    expect(confirmationMatches('night shift', 'Night Shift')).toBe(false);
    expect(confirmationMatches('', 'Night Shift')).toBe(false);
    expect(confirmationMatches(undefined, 'Night Shift')).toBe(false);
    expect(confirmationMatches('Night', 'Night Shift')).toBe(false);
  });
});

describe('which orgs can be deleted here', () => {
  it('never the producer’s own org', () => {
    expect(canDeleteOrgKind('producer')).toBe(false);
    expect(canDeleteOrgKind('label')).toBe(true);
    expect(canDeleteOrgKind('artist')).toBe(true);
  });
});
