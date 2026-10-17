/**
 * Parity between the SQL helper `public.has_org_cap` (migration 136, last
 * redefined by 170 to add entitlements) and the capability model in
 * ./capabilities.ts + ./entitlements.ts, which are the source of truth.
 * The LATEST migration that defines the function is the one parsed: replaying
 * every file leaves that definition in place. Every earlier definition must
 * still agree with it on the data they share.
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
import { FACE_KIND, ACCOUNT_FACES } from './account';
import { CAPABILITY_MODULE, FACE_MODULES, MODULES, entitledCapabilities, orgEntitlements } from './entitlements';
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
const DEFINES = /CREATE OR REPLACE FUNCTION public\.has_org_cap\(/;
/** Every migration that (re)defines has_org_cap, oldest first. */
const DEFINING = readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_.*\.sql$/.test(f) && DEFINES.test(readFileSync(join(MIGRATIONS, f), 'utf8')))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
const FILE = DEFINING[DEFINING.length - 1];

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
  // 170 (LABEL-47): entitlements. Absent from 136's definition.
  capability_modules: Pair[];
  modules: string[];
  kind_faces: Pair[];
  face_modules: Pair[];
};
const LISTS = [
  'all_capabilities',
  'org_kinds',
  'kinds_with_full_ceiling',
  'roles_granted_everything',
  'roles_using_functions',
  'roles_taking_overrides',
  'modules',
] as const;
const PAIRS = [
  'roles_by_org_kind',
  'functions_by_org_kind',
  'role_grants',
  'function_presets',
  'implies',
  'never_grantable',
  'capability_modules',
  'kind_faces',
  'face_modules',
] as const;
const ENTITLEMENT_KEYS = ['capability_modules', 'modules', 'kind_faces', 'face_modules'] as const;

/** Parse the `name constant text[] := ARRAY[...];` constants of has_org_cap. `legacy`: a definition from before 170. */
function parseMapping(sql: string, legacy = false): Mapping {
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
    if (legacy && (ENTITLEMENT_KEYS as readonly string[]).includes(name)) continue;
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
  /** The org's org_entitlements.modules, or null when it has no row. */
  entitled?: readonly string[] | null;
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
  if (revoked.includes(cap)) return false;

  // 6. (170)
  let module: string | null = null;
  for (const [c, mod] of map.capability_modules) if (c === cap) module = mod;
  if (module === null) return true;
  let face: string | null = null;
  for (const [k, f] of map.kind_faces) if (k === m.kind) face = f;
  const inCeiling = face === null ? map.modules.includes(module) : map.face_modules.some(([f, mod]) => f === face && mod === module);
  if (!inCeiling) return false;
  if (m.entitled === null || m.entitled === undefined) return true;
  return m.entitled.includes(module);
}

describe('has_org_cap mapping (latest definition) equals capabilities.ts + entitlements.ts', () => {
  it('finds the definitions: 136 first, 170 the latest', () => {
    expect(DEFINING[0]).toMatch(/^136_labelos_org_core\.sql$/);
    expect(FILE).toMatch(/^170_/);
  });

  const map = parseMapping(readFileSync(join(MIGRATIONS, FILE!), 'utf8'));

  it('every earlier definition agrees with the latest on the data it has', () => {
    for (const file of DEFINING.slice(0, -1)) {
      const old = parseMapping(readFileSync(join(MIGRATIONS, file), 'utf8'), true);
      for (const key of [...LISTS, ...PAIRS]) {
        if ((ENTITLEMENT_KEYS as readonly string[]).includes(key)) continue;
        expect(old[key], `${file}: ${key}`).toEqual(map[key]);
      }
    }
  });

  it('CAPABILITY_MODULE', () => {
    expect(sortPairs(map.capability_modules)).toEqual(sortPairs(Object.entries(CAPABILITY_MODULE).map(([c, m]) => [c, m!] as Pair)));
  });

  it('MODULES', () => {
    expect(map.modules).toEqual([...MODULES]);
  });

  it('FACE_KIND, as [kind, face]', () => {
    expect(sortPairs(map.kind_faces)).toEqual(sortPairs(ACCOUNT_FACES.map((f) => [FACE_KIND[f], f] as Pair)));
  });

  it('FACE_MODULES', () => {
    expect(sortPairs(map.face_modules)).toEqual(sortPairs(pairsOf(FACE_MODULES)));
  });

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
  // An org_entitlements row's modules, or null = no row (the default).
  const ENTITLED: (string[] | null)[] = [null, [], ['contracts'], ['finance', 'export'], [...MODULES], ['bogus', 'Contracts']];

  it('SQL mirror and capabilitiesFor agree on every fixture', () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (const kind of KINDS) {
      for (const role of ROLE_INPUTS) {
        for (const functions of FUNCTION_SETS) {
          for (const overrides of OVERRIDES) {
            for (const entitled of ENTITLED) {
              const row = entitled === null ? null : { modules: entitled, max_seats: null, max_artists: null, setup_done: true };
              const ts = entitledCapabilities(capabilitiesFor(kind, role, functions, overrides), orgEntitlements({ kind }, row).modules);
              const member: SqlMember = {
                kind,
                role,
                functions,
                capGrants: overrides.grant ?? [],
                capRevokes: overrides.revoke ?? [],
                entitled,
              };
              for (const cap of CAPS) {
                checked++;
                const sql = sqlHasOrgCap(map, member, cap);
                if (sql !== ts.has(cap as never)) {
                  mismatches.push(`${kind}/${role}/${functions.join('+')}/${JSON.stringify(overrides)}/${JSON.stringify(entitled)}: ${cap} sql=${sql}`);
                }
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
    // an owner of a licensee without contracts does not hold contracts.read, and keeps the catalogue
    expect(sqlHasOrgCap(map, { ...owner, entitled: ['export'] }, 'contracts.read')).toBe(false);
    expect(sqlHasOrgCap(map, { ...owner, entitled: ['export'] }, 'catalog.read')).toBe(true);
    expect(sqlHasOrgCap(map, { ...owner, entitled: null }, 'contracts.read')).toBe(true);
    expect(sqlHasOrgCap(map, { ...owner, entitled: ['contracts'] }, 'contracts.read')).toBe(true);
  });
});
