import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// Ownership is its own tested module (share-owner.test.ts); here it is a
// switch, so membership can be asserted on its own and together with it.
const grants = { allowed: true };
vi.mock('@/lib/share/share-owner', () => ({
  projectShareOwnerId: async () => 'producer-1',
  shareGrantsTrack: async (_admin: unknown, ownerId: string | null | undefined) => grants.allowed && !!ownerId,
}));

import {
  SHARE_GATE_MESSAGES,
  SHARE_TOKEN_LENGTH,
  isWellFormedShareToken,
  lockableOf,
  newShareToken,
  resolveShareToken,
  resolvedShareIncludesTrack,
  shareAccessFailure,
  shareGateResponse,
  shareLifecycleFailure,
  type ResolvedShare,
} from './token-access';

/** Minimal PostgREST double: rows per table, every query recorded. */
function fakeAdmin(rows: Record<string, unknown>, errors: Record<string, unknown> = {}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const admin = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { call.filters.push([col, val]); return q; },
        maybeSingle: async () => ({ data: errors[table] ? null : (rows[table] ?? null), error: errors[table] ?? null }),
      };
      return q;
    },
  };
  return { admin, calls };
}

beforeEach(() => { grants.allowed = true; });

describe('share tokens', () => {
  it('mints URL-safe tokens of the documented length that pass the shape check', () => {
    const t = newShareToken();
    expect(t).toHaveLength(SHARE_TOKEN_LENGTH);
    expect(isWellFormedShareToken(t)).toBe(true);
  });

  it('accepts every shape the app has issued', () => {
    expect(isWellFormedShareToken('Ocze__ixXGJq')).toBe(true);           // nanoid(12)
    expect(isWellFormedShareToken('demo-share-xyz')).toBe(true);         // seeded fixture
    expect(isWellFormedShareToken('0123456789abcdef'.repeat(3))).toBe(true); // 24-byte hex
  });

  it('refuses anything that cannot be one of ours', () => {
    for (const bad of ['', 'abc', 'x'.repeat(129), 'tok,user_id.is.null', '../etc', 'tok en', 'tök123', null, 42]) {
      expect(isWellFormedShareToken(bad)).toBe(false);
    }
  });
});

describe('the gate', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');

  it('refuses revoked before expired, both as 410', () => {
    expect(shareLifecycleFailure({ revoked_at: '2026-01-01', expires_at: '2020-01-01' }, now))
      .toEqual({ status: 410, error: SHARE_GATE_MESSAGES.revoked });
    expect(shareLifecycleFailure({ expires_at: '2026-09-28T11:59:59Z' }, now))
      .toEqual({ status: 410, error: SHARE_GATE_MESSAGES.expired });
    expect(shareLifecycleFailure({ expires_at: '2026-09-28T12:00:01Z' }, now)).toBeNull();
    expect(shareLifecycleFailure({}, now)).toBeNull();
  });

  it('locks a password share with 401 + requiresPassword, missing or wrong', async () => {
    const share = { password_hash: bcrypt.hashSync('open sesame', 4) };
    expect(await shareAccessFailure(share, { password: '' }))
      .toEqual({ status: 401, error: SHARE_GATE_MESSAGES.passwordRequired, requiresPassword: true });
    expect(await shareAccessFailure(share, { password: 'nope' }))
      .toEqual({ status: 401, error: SHARE_GATE_MESSAGES.passwordIncorrect, requiresPassword: true });
    expect(await shareAccessFailure(share, { password: 'open sesame' })).toBeNull();
  });

  it('says a dead link is dead before asking for its password', async () => {
    const share = { revoked_at: '2026-01-01', password_hash: bcrypt.hashSync('pw', 4) };
    expect((await shareAccessFailure(share, { password: '' }))?.status).toBe(410);
  });

  it('skips only the password for HMAC-granted media, never the lifecycle', async () => {
    const locked = { password_hash: bcrypt.hashSync('pw', 4) };
    expect(await shareAccessFailure(locked, { password: '', checkPassword: false })).toBeNull();
    expect((await shareAccessFailure({ ...locked, revoked_at: '2026-01-01' }, { password: '', checkPassword: false }))?.status)
      .toBe(410);
  });

  it('renders a failure as the response body the share pages read', async () => {
    const res = shareGateResponse({ status: 401, error: 'x', requiresPassword: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'x', requiresPassword: true });
  });
});

describe('resolveShareToken', () => {
  it('never queries for a malformed token', async () => {
    const { admin, calls } = fakeAdmin({ share_links: { token: 'x' } });
    expect(await resolveShareToken(admin, 'a,b', ['share_link'])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('prefers a project share, then a flat link, then a purchase', async () => {
    const all = { project_shares: { id: 'ps' }, share_links: { id: 'sl' }, project_access_links: { project_id: 'p' } };
    const kinds = ['project_share', 'share_link', 'paid_access'] as const;
    expect((await resolveShareToken(fakeAdmin(all).admin, 'Ocze__ixXGJq', kinds))?.kind).toBe('project_share');
    const noProject = { share_links: all.share_links, project_access_links: all.project_access_links };
    expect((await resolveShareToken(fakeAdmin(noProject).admin, 'Ocze__ixXGJq', kinds))?.kind).toBe('share_link');
    expect((await resolveShareToken(fakeAdmin({ project_access_links: all.project_access_links }).admin, 'Ocze__ixXGJq', kinds))?.kind)
      .toBe('paid_access');
  });

  it('only consults the tables a route names', async () => {
    const { admin, calls } = fakeAdmin({ project_access_links: { project_id: 'p' } });
    expect(await resolveShareToken(admin, 'Ocze__ixXGJq', ['project_share', 'share_link'])).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(['project_shares', 'share_links']);
    expect(calls.every((c) => c.filters.some(([col, v]) => col === 'token' && v === 'Ocze__ixXGJq'))).toBe(true);
  });

  it('throws on a database error instead of falling through to the next table', async () => {
    const { admin, calls } = fakeAdmin({ share_links: { id: 'sl' } }, { project_shares: new Error('db down') });
    await expect(resolveShareToken(admin, 'Ocze__ixXGJq', ['project_share', 'share_link'])).rejects.toThrow('db down');
    expect(calls).toHaveLength(1);
  });
});

describe('lockableOf', () => {
  it('treats a purchase as unrevocable and unlocked, expiring when refunded', () => {
    const paid: ResolvedShare = { kind: 'paid_access', row: { project_id: 'p', expires_at: '2026-01-01' } };
    expect(lockableOf(paid)).toEqual({ revoked_at: null, expires_at: '2026-01-01', password_hash: null });
  });
});

describe('resolvedShareIncludesTrack', () => {
  it('flat link: listed AND grantable', async () => {
    const { admin } = fakeAdmin({});
    const link: ResolvedShare = { kind: 'share_link', row: { user_id: 'producer-1', track_ids: ['t1'] } };
    expect(await resolvedShareIncludesTrack(admin, link, 't1')).toBe(true);
    expect(await resolvedShareIncludesTrack(admin, link, 't2')).toBe(false);
    grants.allowed = false;
    expect(await resolvedShareIncludesTrack(admin, link, 't1')).toBe(false);
  });

  it('single-track share covers only its track', async () => {
    const { admin } = fakeAdmin({});
    const share: ResolvedShare = { kind: 'project_share', row: { content_type: 'track', track_id: 't1' } };
    expect(await resolvedShareIncludesTrack(admin, share, 't1')).toBe(true);
    expect(await resolvedShareIncludesTrack(admin, share, 't2')).toBe(false);
  });

  it('playlist share asks playlist_tracks; project share and purchase ask project_tracks', async () => {
    const playlist = fakeAdmin({ playlist_tracks: { track_id: 't1' } });
    expect(await resolvedShareIncludesTrack(playlist.admin,
      { kind: 'project_share', row: { content_type: 'playlist', playlist_id: 'pl1' } }, 't1')).toBe(true);
    expect(playlist.calls[0]).toEqual({ table: 'playlist_tracks', filters: [['playlist_id', 'pl1'], ['track_id', 't1']] });

    const project = fakeAdmin({ project_tracks: { track_id: 't1' } });
    expect(await resolvedShareIncludesTrack(project.admin,
      { kind: 'paid_access', row: { project_id: 'p1' } }, 't1')).toBe(true);
    expect(project.calls[0]).toEqual({ table: 'project_tracks', filters: [['project_id', 'p1'], ['track_id', 't1']] });

    expect(await resolvedShareIncludesTrack(fakeAdmin({}).admin,
      { kind: 'project_share', row: { content_type: 'project', project_id: 'p1' } }, 't1')).toBe(false);
  });

  it('a playlist share with no playlist id falls back to its project, like its owner lookup', async () => {
    const { admin, calls } = fakeAdmin({ project_tracks: { track_id: 't1' } });
    expect(await resolvedShareIncludesTrack(admin,
      { kind: 'project_share', row: { content_type: 'playlist', playlist_id: null, project_id: 'p1' } }, 't1')).toBe(true);
    expect(calls[0].table).toBe('project_tracks');
  });
});
