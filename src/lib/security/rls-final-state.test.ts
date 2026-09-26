/**
 * Replays every migration's CREATE/DROP POLICY in order and asserts on the
 * resulting policy set. RLS is only as strong as the LAST migration that
 * touched a policy, and a single missed table (arrangements survived 097's
 * owner-only sweep for 100 migrations) is invisible in a file-by-file review.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase/migrations');

function finalPolicies(): Map<string, string> {
  const policies = new Map<string, string>();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const re = /(DROP POLICY IF EXISTS|DROP POLICY|CREATE POLICY)\s+("[^"]+"|\S+)\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(re)) {
      const key = `${m[3]}.${m[2].replace(/"/g, '')}`;
      if (m[1].toUpperCase().startsWith('DROP')) policies.delete(key);
      else policies.set(key, m[4].replace(/\s+/g, ' '));
    }
  }
  return policies;
}

describe('final RLS policy state', () => {
  const policies = finalPolicies();

  it('parses a realistic number of policies', () => {
    expect(policies.size).toBeGreaterThan(50);
  });

  it('never lets an authenticated user insert their own creator_profiles row', () => {
    // A profile row IS the producer marker (requireProducer, src/proxy.ts).
    const inserts = [...policies].filter(
      ([k, body]) => k.startsWith('creator_profiles.') && /FOR\s+(INSERT|ALL)/i.test(body),
    );
    expect(inserts).toEqual([]);
  });

  it('no direct-row policy admits a NULL owner (mig 097)', () => {
    // `user_id IS NULL` on the table itself is also true for the anon role.
    // Child "via parent" policies are excluded: their EXISTS subquery runs
    // under the parent's owner-only RLS, which already hides null parents.
    const offenders = [...policies]
      .filter(([, body]) => /user_id\s+IS\s+NULL/i.test(body) && !/EXISTS/i.test(body))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('no table is writable by everyone except append-only telemetry', () => {
    const openWrites = [...policies]
      .filter(([, body]) => /(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(body) && !/FOR\s+SELECT/i.test(body))
      .map(([k]) => k)
      .sort();
    expect(openWrites).toEqual(['play_head_pings.play_head_pings_insert', 'share_plays.public insert play']);
  });

  it('catalogue writes through RLS require the producer, not just any session', () => {
    // Buyers hold Supabase sessions; owner_only alone let them insert
    // store-listed tracks pointing at private audio (mig 119).
    for (const table of ['tracks', 'projects', 'playlists']) {
      const body = policies.get(`${table}.owner_only`) ?? '';
      expect(body, table).toMatch(/WITH CHECK[\s\S]*is_producer\(\)/i);
    }
  });
});
