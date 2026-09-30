/**
 * Label OS capability model — the single source of truth for "who may do
 * what" (docs/bstudio-label-os/06-permission-model.md §2, as decided in
 * 15-product-decisions.md D1/D2/D4/D5).
 *
 * Routes and RLS check CAPABILITIES, never role names. The SQL helper
 * `has_org_cap` will mirror this table and be held equal to it by a parity
 * test, so every grant lives here as data, not as branches.
 *
 * Everything fails closed: an unknown org kind, role, function, capability,
 * recording kind or external role grants nothing. Inputs are typed `string`
 * on purpose — they arrive from the database, and a value this module does
 * not know must not be widened into a grant by a cast.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────

export const ORG_KINDS = ['artist', 'producer', 'label'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** §2.1 base roles. External project members are not org roles (see below). */
export const ROLES = ['owner', 'admin', 'member', 'artist'] as const;
export type Role = (typeof ROLES)[number];

/** §2.2 functions: additive capability bundles for `member`. */
export const ORG_FUNCTIONS = [
  'a_and_r',
  'project_manager',
  'marketing',
  'legal',
  'finance',
  'artist_manager',
  'producer',
  'engineer',
  'operations',
] as const;
export type OrgFunction = (typeof ORG_FUNCTIONS)[number];

export const RELEASE_GATES = ['master', 'artwork', 'legal', 'marketing', 'metadata'] as const;
export type ReleaseGate = (typeof RELEASE_GATES)[number];

/**
 * §2.3 capabilities, plus two narrowings the §2.4 table needs:
 * - `review.comment` — the artist's "comment only" cell (and §2.6's Comment
 *   column): comment without rating or verdict. `review.write` implies it.
 * - `rights.read.own_line` — producer/engineer "R (own line)" and D2 for
 *   external members: see and confirm your own credit and split line only.
 *   `rights.read` implies it.
 */
export const ALL_CAPABILITIES = [
  'catalog.read',
  'catalog.write',
  'audio.finished',
  'audio.working',
  'review.write',
  'review.comment',
  'rights.read',
  'rights.read.own_line',
  'rights.write',
  'contracts.read',
  'release.write',
  'release.approve.master',
  'release.approve.artwork',
  'release.approve.legal',
  'release.approve.marketing',
  'release.approve.metadata',
  'tasks.write',
  'share.external',
  'members.manage',
  'org.manage',
  'finance.read',
  'business.read.internal',
] as const;
export type Capability = (typeof ALL_CAPABILITIES)[number];

// ── Tables ──────────────────────────────────────────────────────────────

/** §2.4b — which roles each org kind offers. */
export const ROLES_BY_ORG_KIND: Readonly<Record<OrgKind, readonly Role[]>> = {
  artist: ['owner', 'admin', 'member'],
  producer: ['owner', 'admin', 'member'],
  label: ['owner', 'admin', 'member', 'artist'],
};

/** §2.4b — which functions each org kind offers. */
export const FUNCTIONS_BY_ORG_KIND: Readonly<Record<OrgKind, readonly OrgFunction[]>> = {
  artist: ['artist_manager', 'producer', 'engineer', 'marketing', 'legal', 'operations'],
  producer: ['producer', 'engineer', 'artist_manager', 'operations'],
  label: ORG_FUNCTIONS,
};

/**
 * §2.4b says a capability needs both the member's grant AND the org kind to
 * allow it. No kind withholds a capability in the MVP (the differences
 * between kinds are the roles and functions they offer), so every ceiling
 * is the full set. It stays a table so a later decision is a data change.
 */
const KIND_CEILING: Readonly<Record<OrgKind, readonly Capability[]>> = {
  artist: ALL_CAPABILITIES,
  producer: ALL_CAPABILITIES,
  label: ALL_CAPABILITIES,
};

/**
 * §2.4 columns. Only the capabilities written here are granted; implied
 * reads are added by `IMPLIES`. `finance` and `operations` have no column
 * in §2.4 and so grant nothing until one is decided — as does `tasks.write`
 * for any function, which §2.4 has no row for.
 */
const FUNCTION_GRANTS: Readonly<Record<OrgFunction, readonly Capability[]>> = {
  a_and_r: [
    'catalog.write',
    'audio.finished',
    'audio.working',
    'review.write',
    'rights.read',
    'release.write',
    'release.approve.master',
    'share.external',
  ],
  project_manager: [
    'catalog.write',
    'audio.finished',
    'audio.working',
    'review.write',
    'rights.read',
    'release.write',
    'release.approve.metadata',
    'share.external',
    'business.read.internal',
  ],
  marketing: [
    'catalog.read',
    'audio.finished',
    'release.approve.artwork',
    'release.approve.marketing',
    'business.read.internal',
  ],
  legal: [
    'catalog.read',
    'audio.finished',
    'rights.write',
    'contracts.read',
    'release.approve.legal',
    'business.read.internal',
  ],
  artist_manager: ['catalog.write', 'audio.finished', 'audio.working', 'review.write', 'rights.read'],
  producer: ['catalog.write', 'audio.finished', 'audio.working', 'rights.read.own_line'],
  engineer: ['catalog.write', 'audio.finished', 'audio.working', 'rights.read.own_line'],
  finance: [],
  operations: [],
};

/**
 * §2.4 role columns. owner/admin: "everything" (§2.1 — the owner-only acts,
 * org deletion and ownership transfer, are not capabilities in §2.3).
 * artist: the artist column; "(own)" / "own songs" is scope, not
 * capability, because role `artist` is always artist-scoped (§2.5).
 * member: nothing by itself; its capabilities come from functions.
 */
const ROLE_GRANTS: Readonly<Record<Role, readonly Capability[]>> = {
  owner: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES,
  member: [],
  artist: ['catalog.write', 'audio.finished', 'audio.working', 'review.comment', 'rights.read'],
};

/** Only `member` takes its capabilities from functions. */
const ROLE_USES_FUNCTIONS: Readonly<Record<Role, boolean>> = {
  owner: false,
  admin: false,
  member: true,
  artist: false,
};

/** A capability that implies a narrower one. Applied to a fixed point. */
const IMPLIES: Readonly<Partial<Record<Capability, readonly Capability[]>>> = {
  'catalog.write': ['catalog.read'],
  'rights.write': ['rights.read'],
  'rights.read': ['rights.read.own_line'],
  'review.write': ['review.comment'],
};

// ── Lookup helpers ──────────────────────────────────────────────────────

/** Own-key lookup, so `toString` / `__proto__` are never a role or kind. */
function known<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function withImplied(caps: Iterable<Capability>): Set<Capability> {
  const out = new Set<Capability>();
  const queue = [...caps];
  while (queue.length) {
    const cap = queue.pop()!;
    if (out.has(cap)) continue;
    out.add(cap);
    queue.push(...(IMPLIES[cap] ?? []));
  }
  return out;
}

// ── Org members ─────────────────────────────────────────────────────────

/**
 * The capabilities of an org member: role grants, plus function grants for
 * `member`, both limited to what the org kind offers, then capped by the
 * kind's ceiling. Returns a fresh set; mutating it changes nothing.
 */
export function capabilitiesFor(
  orgKind: string,
  role: string,
  functions: readonly string[] | null | undefined,
): ReadonlySet<Capability> {
  if (!known(ORG_KINDS, orgKind)) return new Set();
  if (!known(ROLES, role) || !ROLES_BY_ORG_KIND[orgKind].includes(role)) return new Set();

  const granted: Capability[] = [...ROLE_GRANTS[role]];
  if (ROLE_USES_FUNCTIONS[role] && Array.isArray(functions)) {
    for (const fn of functions) {
      if (known(ORG_FUNCTIONS, fn) && FUNCTIONS_BY_ORG_KIND[orgKind].includes(fn)) {
        granted.push(...FUNCTION_GRANTS[fn]);
      }
    }
  }

  const ceiling = KIND_CEILING[orgKind];
  return new Set([...withImplied(granted)].filter((cap) => ceiling.includes(cap)));
}

// ── External project members (§2.6) ─────────────────────────────────────

export const EXTERNAL_PROJECT_ROLES = ['viewer', 'commenter', 'contributor', 'editor'] as const;
export type ExternalProjectRole = (typeof EXTERNAL_PROJECT_ROLES)[number];

/** §2.6 columns. */
export const EXTERNAL_ACTIONS = [
  'listen',
  'comment',
  'upload_versions',
  'edit_metadata',
  'propose_own_credit',
  'download_masters',
] as const;
export type ExternalAction = (typeof EXTERNAL_ACTIONS)[number];

/** `'per_project'` follows the project's `allow_downloads`. */
export type ExternalGrant = boolean | 'per_project';

/** §2.6, cell for cell. */
export const EXTERNAL_PROJECT_ROLE_TABLE: Readonly<
  Record<ExternalProjectRole, Readonly<Record<ExternalAction, ExternalGrant>>>
> = {
  viewer: {
    listen: true,
    comment: false,
    upload_versions: false,
    edit_metadata: false,
    propose_own_credit: false,
    download_masters: 'per_project',
  },
  commenter: {
    listen: true,
    comment: true,
    upload_versions: false,
    edit_metadata: false,
    propose_own_credit: false,
    download_masters: 'per_project',
  },
  contributor: {
    listen: true,
    comment: true,
    upload_versions: true,
    edit_metadata: false,
    propose_own_credit: true,
    download_masters: true,
  },
  editor: {
    listen: true,
    comment: true,
    upload_versions: true,
    edit_metadata: true,
    propose_own_credit: true,
    download_masters: true,
  },
};

/** Whether an external project member may take a §2.6 action on their project. */
export function externalCan(
  role: string,
  action: string,
  project: { allowDownloads?: boolean } = {},
): boolean {
  if (!known(EXTERNAL_PROJECT_ROLES, role) || !known(EXTERNAL_ACTIONS, action)) return false;
  const grant = EXTERNAL_PROJECT_ROLE_TABLE[role][action];
  return grant === 'per_project' ? project.allowDownloads === true : grant;
}

/**
 * The org-capability view of an external member, for code that asks one
 * question of both kinds of member. Deliberately narrow: seeing the project
 * (`catalog.read`), their own credit and split line (D2), and commenting.
 * Listening, uploading, metadata edits and downloads are NOT expressed as
 * `audio.*` / `catalog.write` — those capabilities are wider than any §2.6
 * cell (`audio.finished` includes download; `catalog.write` includes moving
 * stages) — so they are answered by `externalCan` only.
 *
 * Never contains `rights.write`, `contracts.read`, `release.*` or
 * `members.manage` (§2.6).
 */
export function externalCapabilities(role: string): ReadonlySet<Capability> {
  if (!known(EXTERNAL_PROJECT_ROLES, role)) return new Set();
  const caps = new Set<Capability>(['catalog.read', 'rights.read.own_line']);
  if (EXTERNAL_PROJECT_ROLE_TABLE[role].comment === true) caps.add('review.comment');
  return caps;
}

// ── can ─────────────────────────────────────────────────────────────────

export type OrgMemberGrant = {
  orgKind: string;
  role: string;
  functions: readonly string[] | null | undefined;
};
export type ExternalMemberGrant = { externalRole: string };
export type MemberGrant = OrgMemberGrant | ExternalMemberGrant;

/** Does this member hold this capability? Unknown anything → false. */
export function can(member: MemberGrant, cap: Capability): boolean {
  if (!known(ALL_CAPABILITIES, cap)) return false;
  const caps =
    'externalRole' in member
      ? externalCapabilities(member.externalRole)
      : capabilitiesFor(member.orgKind, member.role, member.functions);
  return caps.has(cap);
}

// ── Recording class (§2.3, D4) ──────────────────────────────────────────

/** `song_recordings.kind` (05-domain-model.md). */
export const RECORDING_KINDS = [
  'beat_source',
  'demo',
  'rough',
  'topline',
  'loop',
  'mix',
  'master',
  'instrumental',
  'acapella',
  'clean',
  'reference',
] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];
export type RecordingClass = 'finished' | 'working';

/**
 * §2.3 classes. `mix` is decided per recording (below). `reference` is a
 * `song_recordings` kind §2.3 does not classify; it is `working`, the side
 * fewer people can hear, until someone decides otherwise.
 */
const RECORDING_CLASS: Readonly<Record<Exclude<RecordingKind, 'mix'>, RecordingClass>> = {
  master: 'finished',
  clean: 'finished',
  instrumental: 'finished',
  acapella: 'finished',
  beat_source: 'working',
  demo: 'working',
  rough: 'working',
  topline: 'working',
  loop: 'working',
  reference: 'working',
};

/**
 * Finished or working material, which decides `audio.finished` vs
 * `audio.working`. A `mix` is finished only when it is the song's current
 * mix AND the song is `selected` or on a release; any other mix is an
 * earlier version and working. Unknown kinds → null (nobody's audio
 * capability covers them).
 */
export function recordingClass(
  kind: string,
  opts: { currentMixOfSelectedSong?: boolean } = {},
): RecordingClass | null {
  if (!known(RECORDING_KINDS, kind)) return null;
  if (kind === 'mix') return opts.currentMixOfSelectedSong === true ? 'finished' : 'working';
  return RECORDING_CLASS[kind];
}

/** The audio capability needed to stream/download a recording of this kind. */
export function audioCapabilityFor(
  kind: string,
  opts: { currentMixOfSelectedSong?: boolean } = {},
): 'audio.finished' | 'audio.working' | null {
  const cls = recordingClass(kind, opts);
  if (cls === 'finished') return 'audio.finished';
  if (cls === 'working') return 'audio.working';
  return null;
}
