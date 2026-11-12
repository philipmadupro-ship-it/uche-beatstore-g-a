/**
 * Label OS routes are tenant-scoped by ORG, never by user (06 §3.2). Every
 * route under src/app/api/org/** runs on the service role, so a forgotten or
 * wrong filter is a cross-tenant leak, not a 403. Two rules, checked on the
 * source text because neither tsc nor a green build can see them:
 *
 *  1. No filter on `user_id` equality in any form: `.eq('user_id', …)`,
 *     `.filter('user_id', 'eq', …)`, `.match({ user_id })` or `user_id.eq.`
 *     (the PostgREST `.or()` string form), even wrapped over lines. That is the producer app's tenancy; under /api/org it
 *     scopes a query to "rows this user created" and ignores the org — the
 *     class of bug STORE-02 shipped. Scope reads with `scopedOrgQuery`.
 *  2. Every file imports from `@/lib/auth/org-access`, i.e. it authorises
 *     through requireOrgMember / requireOrgCapability / requireObjectAccess.
 *
 * Test files under the folder are exempt (they assert on these strings).
 * The folder does not exist until the first Label OS route lands; the scan
 * then simply finds nothing, and the fixture tests below keep the checker
 * itself honest.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ORG_API_DIR = join(process.cwd(), 'src/app/api/org');

/**
 * Every way supabase-js / PostgREST can express "user_id equals": `.eq()`,
 * `.filter(col, 'eq', …)`, `.match({ user_id })` and the `.or()` string
 * form. Matched across the whole file, since a formatter wraps long calls
 * over several lines.
 */
const USER_ID_FILTERS: readonly [RegExp, string][] = [
  [/\.eq\(\s*['"`]user_id['"`]/g, ".eq('user_id', …)"],
  [/\.filter\(\s*['"`]user_id['"`]\s*,\s*['"`]eq['"`]/g, ".filter('user_id', 'eq', …)"],
  [/\.match\(\s*\{[^}]*\buser_id\b/g, '.match({ user_id })'],
  [/\buser_id\.eq\b/g, 'user_id.eq filter string'],
];
const ORG_ACCESS_IMPORT = /\bfrom\s+['"]@\/lib\/auth\/org-access['"]/;

type Source = { path: string; source: string };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

export function orgApiViolations(files: readonly Source[]): string[] {
  const out: string[] = [];
  for (const { path, source } of files) {
    if (/\.test\.tsx?$/.test(path)) continue;
    const hits: [number, string][] = [];
    for (const [re, label] of USER_ID_FILTERS) {
      for (const m of source.matchAll(re)) hits.push([lineOf(source, m.index ?? 0), label]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (const [line, label] of hits) out.push(`${path}:${line}: ${label} — scope by org with scopedOrgQuery`);
    if (!ORG_ACCESS_IMPORT.test(source)) out.push(`${path}: does not import from @/lib/auth/org-access`);
  }
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('org API source guard', () => {
  it('src/app/api/org/** scopes by org and authorises through org-access', () => {
    const files = walk(ORG_API_DIR).map((full) => ({
      path: relative(process.cwd(), full),
      source: readFileSync(full, 'utf8'),
    }));
    expect(orgApiViolations(files)).toEqual([]);
  });

  const GOOD = `import { requireOrgCapability, scopedOrgQuery } from '@/lib/auth/org-access';
export async function GET() {
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  return scopedOrgQuery(access.admin, 'projects', access).eq('id', id);
}`;

  it('passes a route that follows both rules', () => {
    expect(orgApiViolations([{ path: 'src/app/api/org/[orgId]/route.ts', source: GOOD }])).toEqual([]);
  });

  it.each([
    [`.eq('user_id', userId)`],
    [`.eq("user_id", userId)`],
    ['.eq(`user_id`, userId)'],
    [`.eq( 'user_id' , userId)`],
    [`.or(\`user_id.eq.\${userId},org_id.eq.\${orgId}\`)`],
    [`.eq(\n      'user_id',\n      userId,\n    )`],
    [`.filter('user_id', 'eq', userId)`],
    [`.match({ org_id: orgId, user_id: userId })`],
  ])('fails on a user_id filter: %s', (snippet) => {
    const source = `${GOOD}\nconst q = admin.from('tracks').select('*')${snippet};`;
    const v = orgApiViolations([{ path: 'src/app/api/org/[orgId]/songs/route.ts', source }]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/route\.ts:7: /);
  });

  it('fails on a route that does not import org-access', () => {
    const source = `import { requireProducer } from '@/lib/auth/ownership';\nexport async function GET() {}`;
    const v = orgApiViolations([{ path: 'src/app/api/org/route.ts', source }]);
    expect(v).toEqual(['src/app/api/org/route.ts: does not import from @/lib/auth/org-access']);
  });

  it('does not accept a look-alike import path', () => {
    const source = `import { requireOrgMember } from '@/lib/auth/org-access-legacy';`;
    expect(orgApiViolations([{ path: 'src/app/api/org/route.ts', source }])).toHaveLength(1);
  });

  it('allows filtering other columns that merely end in user_id', () => {
    const source = `${GOOD}\nq.eq('seller_user_id', x).eq('org_id', y).match({ buyer_user_id: z });\nconst s = 'seller_user_id.eq.' + x;`;
    expect(orgApiViolations([{ path: 'src/app/api/org/route.ts', source }])).toEqual([]);
  });

  it('exempts test files', () => {
    const source = `expect(sql).not.toContain(".eq('user_id'")`;
    expect(orgApiViolations([{ path: 'src/app/api/org/route.test.ts', source }])).toEqual([]);
  });
});
