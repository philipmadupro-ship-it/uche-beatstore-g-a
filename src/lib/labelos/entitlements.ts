/**
 * What a licensee org is entitled to (LABEL-47, doc 21 §5.2 #21, doc 22 §2).
 *
 * The platform operator decides, per org, which MODULES exist for it and how
 * many seats and artists it may have. That decision is one row of
 * `org_entitlements` (migration 170); `orgEntitlements` turns it into the set
 * the rest of the app reads. Plans, pricing and metering are NOT here: they
 * will narrow this same object later, so nothing else has to change.
 *
 * Rules this module holds:
 *  - NO ROW = everything the org's face allows. Every org that existed before
 *    LABEL-47, the producer's personal org and every test fixture therefore
 *    keeps working unchanged.
 *  - A row narrows: modules = row.modules ∩ the face ceiling. An unknown
 *    module name grants nothing (fail closed, like an unknown capability).
 *  - A module can own capabilities (`CAPABILITY_MODULE`). An org without the
 *    module does not hold them, whatever the member's role or overrides:
 *    `entitledCapabilities` removes them AFTER the capability model has
 *    closed its grants, so revoking a module never takes away a narrower
 *    capability another module or the core still gives (contracts.read
 *    implies catalog.read; catalog.read stays). The SQL twin is the
 *    `capability_modules` / `face_modules` data in has_org_cap (170), held
 *    equal to these tables by capabilities.sql.test.ts.
 *  - A module the org is not entitled to is ABSENT, not forbidden: its pages
 *    and routes answer 404 and its nav entry is not drawn
 *    (requireOrgCapability / requireOrgModule in lib/auth/org-access).
 *  - Caps: null = unlimited. A set cap is enforced where people are added
 *    (invitations, joining, roster contacts) with a plain 409.
 */
import { ALL_CAPABILITIES, type Capability } from './capabilities';
import { accountFace, type AccountFace } from './account';

// ── Vocabulary ──────────────────────────────────────────────────────────

/**
 * The modules a licence can switch on or off. Departments that have no pages
 * yet (finance, marketing, pr, executive, artistic) are listed now so a
 * licence can already say whether the org will get them; their pages and
 * capabilities (LABEL-49 onwards) are gated through this list when they land.
 */
export const MODULES = [
  'contracts',
  'finance',
  'marketing',
  'pr',
  'executive',
  'artistic',
  'store',
  'search',
  'digest',
  'export',
] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Readonly<Record<Module, string>> = {
  contracts: 'Contracts & legal',
  finance: 'Finance',
  marketing: 'Marketing',
  pr: 'PR & press',
  executive: 'Executive',
  artistic: 'Artistic direction',
  store: 'Store listing',
  search: 'Search',
  digest: 'Weekly digest',
  export: 'Data export',
};

/**
 * Which modules each face may be granted at all (the ceiling a row narrows).
 * No face withholds a module today (doc 22 §8: the access the owner grants
 * decides, not the face); it stays a table so a later decision is data.
 */
export const FACE_MODULES: Readonly<Record<AccountFace, readonly Module[]>> = {
  independent: MODULES,
  label: MODULES,
};

/**
 * The capabilities a module owns: an org without the module holds none of
 * them. LABEL-49 added the department capabilities. Keep in step with
 * `capability_modules` in has_org_cap (latest: 171).
 */
export const CAPABILITY_MODULE: Readonly<Partial<Record<Capability, Module>>> = {
  'contracts.read': 'contracts',
  'contracts.write': 'contracts',
  'contracts.sign': 'contracts',
  'finance.read': 'finance',
  'finance.write': 'finance',
  'finance.approve': 'finance',
  'pr.read': 'pr',
  'pr.write': 'pr',
  'exec.read': 'executive',
  'creative.read': 'artistic',
  'creative.approve': 'artistic',
};

// ── Lookups ─────────────────────────────────────────────────────────────

export function isModule(value: unknown): value is Module {
  return typeof value === 'string' && (MODULES as readonly string[]).includes(value);
}

/** The module that owns `cap`, or null for a core capability. */
export function moduleOfCapability(cap: string): Module | null {
  if (!(ALL_CAPABILITIES as readonly string[]).includes(cap)) return null;
  return CAPABILITY_MODULE[cap as Capability] ?? null;
}

/** The modules an org of this kind may be granted (the producer's own org: all). */
export function moduleCeiling(kind: string | null | undefined): readonly Module[] {
  const face = accountFace({ kind });
  return face ? FACE_MODULES[face] : MODULES;
}

/** Known, de-duplicated, inside the ceiling, in `MODULES` order. */
export function normalizeModules(kind: string | null | undefined, list: readonly unknown[] | null | undefined): Module[] {
  const ceiling = moduleCeiling(kind);
  const wanted = new Set(Array.isArray(list) ? list.filter(isModule) : []);
  return MODULES.filter((m) => wanted.has(m) && ceiling.includes(m));
}

// ── The entitlement object ──────────────────────────────────────────────

/** A row of `org_entitlements` as read from the database. */
export type EntitlementRow = {
  modules: string[] | null;
  max_seats: number | null;
  max_artists: number | null;
  setup_done: boolean | null;
};

export type Entitlements = {
  modules: ReadonlySet<Module>;
  /** Staff seats (members whose role is not `artist`); null = unlimited. */
  maxSeats: number | null;
  /** Roster artists (contacts with an artist role); null = unlimited. */
  maxArtists: number | null;
  /** LABEL-48's setup wizard has run. True for every org without a row. */
  setupDone: boolean;
  /** The operator has written a row for this org (false = the default). */
  licensed: boolean;
};

function cap(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The org's entitlements: the default (everything the face allows) without a row. */
export function orgEntitlements(org: { kind: string | null | undefined }, row: EntitlementRow | null | undefined): Entitlements {
  if (!row) {
    return { modules: new Set(moduleCeiling(org.kind)), maxSeats: null, maxArtists: null, setupDone: true, licensed: false };
  }
  return {
    modules: new Set(normalizeModules(org.kind, row.modules)),
    maxSeats: cap(row.max_seats),
    maxArtists: cap(row.max_artists),
    setupDone: row.setup_done === true,
    licensed: true,
  };
}

/** Is a capability allowed by the org's modules? Core capabilities always are. */
export function capabilityEntitled(capability: string, modules: ReadonlySet<Module | string>): boolean {
  const owner = moduleOfCapability(capability);
  return owner === null || modules.has(owner);
}

/** `caps` without the capabilities of modules the org does not have. A fresh set. */
export function entitledCapabilities(caps: Iterable<Capability>, modules: ReadonlySet<Module | string>): Set<Capability> {
  return new Set([...caps].filter((c) => capabilityEntitled(c, modules)));
}

// ── Caps ────────────────────────────────────────────────────────────────

/**
 * Adding one more would exceed the cap? `used` counts what already holds a
 * place (for seats, pending invitations too). Null = fine. The message is
 * what the 409 says, in plain words.
 */
export function seatLimitError(used: number, maxSeats: number | null): string | null {
  if (maxSeats === null || used < maxSeats) return null;
  return `This organization has used all ${maxSeats} of its seats. Remove someone or ask for more seats.`;
}

export function artistLimitError(used: number, maxArtists: number | null): string | null {
  if (maxArtists === null || used < maxArtists) return null;
  return `This organization already has ${maxArtists} artist${maxArtists === 1 ? '' : 's'}, the most its licence allows.`;
}

/** Roles that take a seat. A roster artist's login is counted under artists, not seats. */
export function takesSeat(role: string): boolean {
  return role !== 'artist';
}
