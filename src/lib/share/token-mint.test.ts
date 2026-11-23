import { describe, it, expect, vi } from 'vitest';
import {
  TOKEN_CONSTRAINTS,
  TokenMintError,
  insertWithFreshToken,
  isTokenCollision,
  withFreshToken,
} from './token-mint';

const dup = (constraint: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${constraint}"`,
  details: 'Key (token)=(abc) already exists.',
});

function minter() {
  let n = 0;
  return vi.fn(() => `tok-${++n}`);
}

describe('TOKEN_CONSTRAINTS', () => {
  it('is exactly the three table keys plus the cross-table trigger', () => {
    expect([...TOKEN_CONSTRAINTS].sort()).toEqual([
      'artist_portals_token_key',
      'project_shares_token_key',
      'share_links_token_key',
      'share_token_cross_table_unique',
    ]);
  });
});

describe('isTokenCollision', () => {
  it.each(TOKEN_CONSTRAINTS.map((c) => [c]))('recognises 23505 on %s', (c) => {
    expect(isTokenCollision(dup(c))).toBe(true);
  });
  it('accepts a node-pg style `constraint` field', () => {
    expect(isTokenCollision({ code: '23505', constraint: 'share_links_token_key' })).toBe(true);
  });
  it('refuses a 23505 on another constraint, even one that mentions "token"', () => {
    expect(isTokenCollision(dup('artist_portals_contact_id_key'))).toBe(false);
    expect(isTokenCollision(dup('some_token_thing'))).toBe(false);
    expect(isTokenCollision({ code: '23505', message: 'duplicate key (share_links_token_key)' })).toBe(false);
  });
  it('refuses other codes, null and non-objects', () => {
    expect(isTokenCollision({ ...dup('share_links_token_key'), code: '23503' })).toBe(false);
    expect(isTokenCollision(null)).toBe(false);
    expect(isTokenCollision('23505')).toBe(false);
  });
});

describe('withFreshToken', () => {
  it('returns the first success with the token it used', async () => {
    const mint = minter();
    const write = vi.fn(async (t: string) => ({ data: { t }, error: null }));
    const res = await withFreshToken(write, { mint });
    expect(res).toEqual({ data: { t: 'tok-1' }, error: null, token: 'tok-1' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('mints again after a token collision', async () => {
    const mint = minter();
    const write = vi.fn()
      .mockResolvedValueOnce({ data: null, error: dup('share_links_token_key') })
      .mockResolvedValueOnce({ data: { ok: 1 }, error: null });
    const res = await withFreshToken(write, { mint });
    expect(write.mock.calls.map((c) => c[0])).toEqual(['tok-1', 'tok-2']);
    expect(res.token).toBe('tok-2');
    expect(res.error).toBeNull();
  });

  it('retries the cross-table trigger refusal too', async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ data: null, error: dup('share_token_cross_table_unique') })
      .mockResolvedValueOnce({ data: {}, error: null });
    const res = await withFreshToken(write, { mint: minter() });
    expect(res.token).toBe('tok-2');
  });

  it('gives up after 3 collisions with a clear error', async () => {
    const write = vi.fn(async () => ({ data: null, error: dup('project_shares_token_key') }));
    await expect(withFreshToken(write, { mint: minter() })).rejects.toThrow(TokenMintError);
    await expect(withFreshToken(write, { mint: minter() })).rejects.toThrow('Could not create a link, try again');
    expect(write).toHaveBeenCalledTimes(6); // 3 + 3
  });

  it('honours a custom attempt count', async () => {
    const write = vi.fn(async () => ({ data: null, error: dup('share_links_token_key') }));
    await expect(withFreshToken(write, { attempts: 1, mint: minter() })).rejects.toThrow(TokenMintError);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through without retrying', async () => {
    const err = { code: '42703', message: 'column does not exist' };
    const write = vi.fn(async () => ({ data: null, error: err }));
    const res = await withFreshToken(write, { mint: minter() });
    expect(res.error).toBe(err);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('never retries a 23505 on a non-token constraint', async () => {
    const err = dup('artist_portals_contact_id_key');
    const write = vi.fn(async () => ({ data: null, error: err }));
    const res = await withFreshToken(write, { mint: minter() });
    expect(res.error).toBe(err);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('insertWithFreshToken', () => {
  it('builds the row per attempt and retries on a token collision', async () => {
    const results = [
      { data: null, error: dup('artist_portals_token_key') },
      { data: { id: 'p1' }, error: null },
    ];
    const insert = vi.fn(() => ({ select: vi.fn(() => ({ single: () => Promise.resolve(results.shift()) })) }));
    const admin = { from: vi.fn(() => ({ insert })) };
    const buildRow = vi.fn((token: string) => ({ token, contact_id: 'c1' }));
    const res = await insertWithFreshToken(admin, 'artist_portals', buildRow, { mint: minter() });
    expect(admin.from).toHaveBeenCalledWith('artist_portals');
    expect(insert.mock.calls).toEqual([[{ token: 'tok-1', contact_id: 'c1' }], [{ token: 'tok-2', contact_id: 'c1' }]]);
    expect(res.data).toEqual({ id: 'p1' });
    expect(res.token).toBe('tok-2');
  });
});
