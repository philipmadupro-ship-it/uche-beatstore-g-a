import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, FUNCTIONS, SEED_MARKER, emailFor } from '../../../scripts/ops/test-accounts-model.mjs';
import { buildSeedSql, resolvePasswords } from '../../../scripts/ops/seed-test-accounts.mjs';
import { buildRemoveSql } from '../../../scripts/ops/remove-test-accounts.mjs';
import { ORG_FUNCTIONS } from './capabilities';

type Account = { tag: string; org: string | null; role: string | null; functions: string[]; artists: string[] };
const accounts = ACCOUNTS as Account[];

describe('test accounts model', () => {
  it('lists exactly the functions of the capability model', () => {
    expect([...FUNCTIONS].sort()).toEqual([...ORG_FUNCTIONS].sort());
  });

  it('has one plain member per function, one limited A&R, two roster artists', () => {
    const plain = accounts.filter((a) => a.role === 'member' && a.artists.length === 0);
    expect(plain.flatMap((a) => a.functions).sort()).toEqual([...ORG_FUNCTIONS].sort());
    expect(accounts.filter((a) => a.role === 'member' && a.artists.length > 0)).toHaveLength(1);
    expect(accounts.filter((a) => a.role === 'artist')).toHaveLength(2);
    expect(new Set(accounts.map((a) => a.tag)).size).toBe(accounts.length);
  });

  it('builds seed SQL that needs passwords and marks every user', () => {
    expect(() => resolvePasswords({})).toThrow(/no password/);
    expect(() => resolvePasswords({ password: 'short' })).toThrow(/shorter/);
    const sql = buildSeedSql({ emailBase: 'someone@example.com', passwords: resolvePasswords({ password: "it's-a-Long-pw" }) });
    expect(sql).toContain(SEED_MARKER);
    expect(sql).toContain("'it''s-a-Long-pw'");
    expect(sql).toContain(emailFor('someone@example.com', 'owner'));
    expect(sql).not.toContain('philipmadupro');
  });

  it('removes only marked, named users', () => {
    const sql = buildRemoveSql({ emailBase: 'someone@example.com' });
    expect(sql).toContain(`raw_user_meta_data ->> 'seed' = '${SEED_MARKER}'`);
    expect(sql).toContain('interval \'31 days\'');
    expect(sql).not.toMatch(/DELETE FROM auth\.users;/);
  });

  it('commits no password: the model and generator hold no credential literal', () => {
    for (const f of ['test-accounts-model.mjs', 'seed-test-accounts.mjs', 'remove-test-accounts.mjs']) {
      expect(readFileSync(new URL(`../../../scripts/ops/${f}`, import.meta.url), 'utf8')).not.toMatch(/password\s*[:=]\s*['"][^'"]{6,}['"]/i);
    }
  });
});
