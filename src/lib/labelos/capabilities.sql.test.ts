/**
 * Parity between the SQL helper `public.has_org_cap` (migration 136) and the
 * capability model in ./capabilities.ts, which is the source of truth.
 *
 * Two halves:
 *  1. DATA — the constants between `labelos:mapping:start` / `:end` in the
 *     migration are parsed and asserted equal to the TypeScript tables.
 *  2. RULES — CI has no Postgres, so `sqlHasOrgCap` below is a line-for-line
 *     mirror of the plpgsql body (steps 1–5 in the migration's comment),
 *     driven ONLY by the parsed SQL constants. It is compared with
 *     `capabilitiesFor` over every kind × role × function set × override
 *     fixture × capability. If you change the plpgsql algorithm, change the
 *     mirror in the same commit; the mirror is not a second implementation of
 *     the product rule, it is a transcription of the SQL.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_CAPABILITIES,
  FUNCTION_PRESETS,
  FUNCTIONS_BY_ORG_KIND,
  IMPLIES,
  KIND_CEILING,
  NEVER_GRANTABLE,
  ORG_FUNCTIONS,
  ORG_KINDS,
  ROLE_GRANTS,
  ROLE_TAKES_OVERRIDES,
  ROLE_USES_FUNCTIONS,
  ROLES,
  ROLES_BY_ORG_KIND,
  capabilitiesFor,
  type CapabilityOverrides,
} from './capabilities';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const FILE = readdirSync(MIGRATIONS).find((f) => /^\d+_labelos_org_core\.sql$/.test(f));

type Pair = [string, string];
type Mapping = {
  all_capabilities: string[];
  org_kinds: string[];
  roles_by_org_kind: Pair[];
  functions_by_org_kind: Pair[];
  kinds_with_full_ceiling: string[];
  roles_granted_everything: string[];
  role_grants: Pair[];
  roles_using_functions: string[];
  roles_taking_overrides: string[];
  function_presets: Pair[];
  implies: Pair[];
  never_grantable: Pair[];
};
const LISTS = [
  'all_capabilities',
  'org_kinds',
  'kinds_with_full_ceiling',
  'roles_granted_everything',
  'roles_using_functions',
  'roles_taking_overrides',
] as const;
const PAIRS = [
  'roles_by_org_kind',
  'functions_by_org_kind',
  'role_grants',
  'function_presets',
  'implies',
  'never_grantable',
] as const;

/** Parse the `name constant text[] := ARRAY[...];` constants of has_org_cap. */
function parseMapping(sql: string): Mapping {
  const block = /--\s*labelos:mapping:start([\s\S]*?)--\s*labelos:mapping:end/.exec(sql);
  if (!block) throw new Error('labelos:mapping markers not found');
  const body = block[1].replace(/--[^\n]*/g, '');
  const out: Record<string, unknown> = {};
  for (const m of body.matchAll(/(\w+)\s+constant\s+text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]\s*;/g)) {
    const [, name, inner] = m;
    const pairs = [...inner.matchAll(/\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)].map((p) => [p[1], p[2]] as Pair);
    out[name] = pairs.length ? pairs : [...inner.matchAll(/'([^']*)'/g)].map((s) => s[1]);
  }
  for (const name of [...LISTS, ...PAIRS]) {
    if (!Array.isArray(out[name])) throw new Error(`constant ${name} not found in has_org_cap`);
  }
  return out as Mapping;
}

function pairsOf(record: Readonly<Partial<Record<string, readonly string[]>>>): Pair[] {
  return Object.entries(record).flatMap(([k, vs]) => (vs ?? []).map((v) => [k, v] as Pair));
}
const sortPairs = (ps: Pair[]) => ps.map((p) => p.join(' → ')).sort();
const sorted = (xs: readonly string[]) => [...xs].sort();

type SqlMember = {
  kind: string;
  role: string;
  functions: readonly string[];
  capGrants: readonly string[];
  capRevokes: readonly string[];
};

/** Mirror of the plpgsql body of has_org_cap, step for step. */
function sqlHasOrgCap(map: Mapping, m: SqlMember, cap: string): boolean {
  if (!map.all_capabilities.includes(cap)) return false;
  if (!map.org_kinds.includes(m.kind)) return false;

  // 1.
  if (!map.roles_by_org_kind.some(([k, r]) => k === m.kind && r === m.role)) return false;

  // 2.
  let granted: string[] = [];
  if (map.roles_granted_everything.includes(m.role)) granted = [...map.all_capabilities];
  else for (const [r, c] of map.role_grants) if (r === m.role) granted.push(c);

  if (map.roles_using_functions.includes(m.role)) {
    for (const fn of m.functions) {
      for (const [k, f] of map.functions_by_org_kind) {
        if (k === m.kind && f === fn) {
          for (const [pf, c] of map.function_presets) if (pf === fn) granted.push(c);
        }
      }
    }
  }

  let revoked: string[] = [];
  if (map.roles_taking_overrides.includes(m.role)) {
    granted = granted.concat(m.capGrants.filter((c) => map.all_capabilities.includes(c)));
    revoked = m.capRevokes.filter((c) => map.all_capabilities.includes(c));
    // 3.
    for (let grown = true; grown; ) {
      grown = false;
      for (const [wider, narrower] of map.implies) {
        if (revoked.includes(narrower) && !revoked.includes(wider)) {
          revoked.push(wider);
          grown = true;
        }
      }
    }
  }

  // 4.
  for (let grown = true; grown; ) {
    grown = false;
    for (const [wider, narrower] of map.implies) {
      if (granted.includes(wider) && !granted.includes(narrower)) {
        granted.push(narrower);
        grown = true;
      }
    }
  }

  // 5.
  if (!granted.includes(cap) || !map.kinds_with_full_ceiling.includes(m.kind)) return false;
  if (map.never_grantable.some(([r, c]) => r === m.role && c === cap)) return false;
  return !revoked.includes(cap);
}

describe('has_org_cap mapping (migration 136) equals capabilities.ts', () => {
  it('finds exactly one org-core migration', () => {
    expect(FILE).toBeDefined();
  });

  const map = parseMapping(readFileSync(join(MIGRATIONS, FILE!), 'utf8'));

  it('capability vocabulary', () => {
    expect(map.all_capabilities).toEqual([...ALL_CAPABILITIES]);
  });

  it('org kinds', () => {
    expect(map.org_kinds).toEqual([...ORG_KINDS]);
  });

  it('ROLES_BY_ORG_KIND', () => {
    expect(sortPairs(map.roles_by_org_kind)).toEqual(sortPairs(pairsOf(ROLES_BY_ORG_KIND)));
  });

  it('FUNCTIONS_BY_ORG_KIND', () => {
    expect(sortPairs(map.functions_by_org_kind)).toEqual(sortPairs(pairsOf(FUNCTIONS_BY_ORG_KIND)));
  });

  it('FUNCTION_PRESETS', () => {
    expect(sortPairs(map.function_presets)).toEqual(sortPairs(pairsOf(FUNCTION_PRESETS)));
  });

  it('IMPLIES', () => {
    expect(sortPairs(map.implies)).toEqual(sortPairs(pairsOf(IMPLIES)));
  });

  it('NEVER_GRANTABLE', () => {
    expect(sortPairs(map.never_grantable)).toEqual(sortPairs(pairsOf(NEVER_GRANTABLE)));
  });

  it('ROLE_GRANTS: full roles listed, the rest as pairs', () => {
    const full = ROLES.filter((r) => sorted(ROLE_GRANTS[r]).join() === sorted(ALL_CAPABILITIES).join());
    expect(sorted(map.roles_granted_everything)).toEqual(sorted(full));
    const partial = Object.fromEntries(ROLES.filter((r) => !full.includes(r)).map((r) => [r, ROLE_GRANTS[r]]));
    expect(sortPairs(map.role_grants)).toEqual(sortPairs(pairsOf(partial)));
  });

  it('ROLE_USES_FUNCTIONS and ROLE_TAKES_OVERRIDES', () => {
    expect(sorted(map.roles_using_functions)).toEqual(sorted(ROLES.filter((r) => ROLE_USES_FUNCTIONS[r])));
    expect(sorted(map.roles_taking_overrides)).toEqual(sorted(ROLES.filter((r) => ROLE_TAKES_OVERRIDES[r])));
  });

  it('KIND_CEILING: the SQL can only express full ceilings, so every TS ceiling must be full', () => {
    // A partial ceiling in TS needs a new constant in has_org_cap first.
    for (const kind of ORG_KINDS) {
      expect(sorted(KIND_CEILING[kind]), kind).toEqual(sorted(ALL_CAPABILITIES));
    }
    expect(sorted(map.kinds_with_full_ceiling)).toEqual(sorted(ORG_KINDS));
  });

  it('parser rejects a migration without the mapping markers', () => {
    expect(() => parseMapping('SELECT 1;')).toThrow(/markers/);
  });

  // ── Rules: the mirror of the SQL agrees with capabilitiesFor ──────────

  const OVERRIDES: CapabilityOverrides[] = [
    {},
    { grant: ['rights.write'] },
    { grant: ['members.manage', 'org.manage', 'business.read.internal', 'contracts.read'] },
    { revoke: ['catalog.read'] },
    { revoke: ['rights.read.own_line'] },
    { revoke: ['review.comment'] },
    { grant: ['release.write'], revoke: ['release.write'] },
    { grant: ['finance.read', 'share.external'], revoke: ['audio.working'] },
    { grant: ['not.a.cap', '__proto__'], revoke: ['toString'] },
    { grant: [...ALL_CAPABILITIES] },
  ];
  const FUNCTION_SETS: string[][] = [
    [],
    ['bogus'],
    ...ORG_FUNCTIONS.map((f) => [f]),
    ['a_and_r', 'legal'],
    ['marketing', 'project_manager'],
    ['producer', 'engineer', 'operations'],
    [...ORG_FUNCTIONS],
  ];
  const KINDS = [...ORG_KINDS, 'studio'];
  const ROLE_INPUTS = [...ROLES, 'superuser'];
  const CAPS = [...ALL_CAPABILITIES, 'bogus.cap'];

  it('SQL mirror and capabilitiesFor agree on every fixture', () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (const kind of KINDS) {
      for (const role of ROLE_INPUTS) {
        for (const functions of FUNCTION_SETS) {
          for (const overrides of OVERRIDES) {
            const ts = capabilitiesFor(kind, role, functions, overrides);
            const member: SqlMember = {
              kind,
              role,
              functions,
              capGrants: overrides.grant ?? [],
              capRevokes: overrides.revoke ?? [],
            };
            for (const cap of CAPS) {
              checked++;
              const sql = sqlHasOrgCap(map, member, cap);
              if (sql !== ts.has(cap as never)) {
                mismatches.push(`${kind}/${role}/${functions.join('+')}/${JSON.stringify(overrides)}: ${cap} sql=${sql}`);
              }
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(10_000);
  });

  it('spot checks that the mirror is not trivially false', () => {
    const owner = { kind: 'label', role: 'owner', functions: [], capGrants: [], capRevokes: [] };
    expect(sqlHasOrgCap(map, owner, 'members.manage')).toBe(true);
    const aandr = { kind: 'label', role: 'member', functions: ['a_and_r'], capGrants: [], capRevokes: [] };
    expect(sqlHasOrgCap(map, aandr, 'catalog.read')).toBe(true);
    expect(sqlHasOrgCap(map, aandr, 'rights.write')).toBe(false);
    // revoking catalog.read removes everything that needs it
    expect(sqlHasOrgCap(map, { ...aandr, capRevokes: ['catalog.read'] }, 'release.write')).toBe(false);
    // a roster artist can never be granted contracts
    const artist = { kind: 'label', role: 'artist', functions: [], capGrants: ['contracts.read'], capRevokes: [] };
    expect(sqlHasOrgCap(map, artist, 'contracts.read')).toBe(false);
  });
});
