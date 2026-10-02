/**
 * Changing and removing org members (LABEL-09, 06 §2, 15 "LABEL-02
 * follow-up"). Pure rules shared by `PATCH/DELETE /api/org/[orgId]/members`
 * and the members page, so the page never offers what the route refuses.
 *
 * What a change may do:
 *  - a role the org KIND offers (ROLES_BY_ORG_KIND), never `owner`: making an
 *    owner is the owner-only ownership transfer, not built here;
 *  - functions the kind offers (FUNCTIONS_BY_ORG_KIND), only for a role that
 *    takes them (`member`);
 *  - per-member switches (`cap_grants` / `cap_revokes`) only for a role that
 *    takes them, and never a NEVER_GRANTABLE capability. Revoke wins;
 *  - scope: an artist is always artist-scoped, an owner/admin never (06 §2.5).
 * Who may make it:
 *  - an owner row is touched only by an owner (as 136's RLS says);
 *  - nobody raises their own role or abilities;
 *  - the last owner is never demoted or removed (409; 136's trigger is the
 *    backstop).
 * Every change is ONE audit event: member.role_changed when the role moved,
 * else member.capabilities_changed (functions or switches), else
 * member.scope_changed; its payload names every field that moved.
 */
import {
  ALL_CAPABILITIES,
  FUNCTIONS_BY_ORG_KIND,
  IMPLIES,
  KIND_CEILING,
  NEVER_GRANTABLE,
  ORG_FUNCTIONS,
  ORG_KINDS,
  ROLES,
  ROLES_BY_ORG_KIND,
  ROLE_TAKES_OVERRIDES,
  ROLE_USES_FUNCTIONS,
  capabilitiesFor,
  type Capability,
  type CapabilityOverrides,
  type OrgFunction,
  type OrgKind,
  type Role,
} from './capabilities';
import type { EventPayload } from './activity';

export type MemberScope = 'org' | 'artists';

/** A membership as the rules see it (an `org_members` row, camel-cased). */
export type MemberState = {
  userId: string;
  role: string;
  functions: readonly string[];
  scope: string;
  capGrants: readonly string[];
  capRevokes: readonly string[];
};

export type MemberActor = { userId: string; role: Role };

/** The body of PATCH /api/org/[orgId]/members, minus `user_id`. */
export type MemberChange = {
  role?: string;
  functions?: readonly string[];
  scope?: string;
  cap_grants?: readonly string[];
  cap_revokes?: readonly string[];
};

export type MemberPatch = Partial<{
  role: Role;
  functions: OrgFunction[];
  scope: MemberScope;
  cap_grants: Capability[];
  cap_revokes: Capability[];
}>;

export type MemberEvent = {
  verb: 'member.role_changed' | 'member.capabilities_changed' | 'member.scope_changed';
  payload: EventPayload;
};

export type Refusal = { ok: false; status: 400 | 403 | 409; error: string };
export type ChangePlan = { ok: true; noop: boolean; patch: MemberPatch; event: MemberEvent | null } | Refusal;

/** For "raise": a self-change may only keep or lower this. */
const ROLE_RANK: Readonly<Record<Role, number>> = { owner: 3, admin: 2, member: 1, artist: 1 };

const LAST_OWNER = 'An organization must keep at least one owner. Make someone else owner first.';

function refuse(status: Refusal['status'], error: string): Refusal {
  return { ok: false, status, error };
}

function knownIn<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function dedupe<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

function capList(list: readonly string[], field: string): Capability[] | Refusal {
  const out: Capability[] = [];
  for (const c of list) {
    if (!knownIn(ALL_CAPABILITIES, c)) return refuse(400, `Unknown ability "${c}" in ${field}`);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

function isRefusal(v: unknown): v is Refusal {
  return !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false;
}

export function planMemberChange(
  orgKind: OrgKind,
  actor: MemberActor,
  target: MemberState,
  change: MemberChange,
  ownerCount: number,
): ChangePlan {
  const currentRole = ROLES.find((r) => r === target.role);
  if (!currentRole) return refuse(409, 'This membership has a role this organization does not offer');

  if (currentRole === 'owner' && actor.role !== 'owner') return refuse(403, 'Only an owner can change an owner');

  // ── role ──
  let role: Role = currentRole;
  if (change.role !== undefined && change.role !== currentRole) {
    const next = ROLES.find((r) => r === change.role);
    if (!next) return refuse(400, `Unknown role "${change.role}"`);
    if (!ROLES_BY_ORG_KIND[orgKind].includes(next)) return refuse(400, `A ${orgKind} organization does not offer the role "${next}"`);
    if (next === 'owner') return refuse(400, 'Ownership is transferred, not assigned');
    role = next;
  }

  const self = actor.userId.toLowerCase() === target.userId.toLowerCase();
  if (self && ROLE_RANK[role] > ROLE_RANK[currentRole]) return refuse(403, 'You cannot raise your own role');
  if (currentRole === 'owner' && role !== 'owner' && ownerCount <= 1) return refuse(409, LAST_OWNER);

  // ── functions ──
  const currentFunctions = target.functions.filter((f): f is OrgFunction => knownIn(ORG_FUNCTIONS, f));
  let functions: OrgFunction[];
  if (change.functions !== undefined) {
    functions = [];
    for (const raw of change.functions) {
      if (!knownIn(ORG_FUNCTIONS, raw)) return refuse(400, `Unknown function "${raw}"`);
      if (!FUNCTIONS_BY_ORG_KIND[orgKind].includes(raw)) return refuse(400, `A ${orgKind} organization does not offer the function "${raw}"`);
      if (!functions.includes(raw)) functions.push(raw);
    }
    if (functions.length > 0 && !ROLE_USES_FUNCTIONS[role]) return refuse(400, `The ${role} role does not take functions`);
  } else {
    functions = ROLE_USES_FUNCTIONS[role] ? currentFunctions : [];
  }
  if (!ROLE_USES_FUNCTIONS[role]) functions = [];

  // ── per-member switches ──
  const takes = ROLE_TAKES_OVERRIDES[role];
  const forbidden = NEVER_GRANTABLE[role];
  let grants: Capability[];
  let revokes: Capability[];
  if (change.cap_grants !== undefined) {
    const g = capList(change.cap_grants, 'cap_grants');
    if (isRefusal(g)) return g;
    if (g.length > 0 && !takes) return refuse(400, `The ${role} role holds every ability; it takes no switches`);
    const bad = g.find((c) => forbidden.includes(c));
    if (bad) return refuse(400, `"${bad}" cannot be switched on for the ${role} role`);
    grants = g;
  } else {
    grants = takes
      ? dedupe(target.capGrants.filter((c): c is Capability => knownIn(ALL_CAPABILITIES, c) && !forbidden.includes(c)))
      : [];
  }
  if (change.cap_revokes !== undefined) {
    const r = capList(change.cap_revokes, 'cap_revokes');
    if (isRefusal(r)) return r;
    if (r.length > 0 && !takes) return refuse(400, `The ${role} role holds every ability; it takes no switches`);
    revokes = r;
  } else {
    revokes = takes ? dedupe(target.capRevokes.filter((c): c is Capability => knownIn(ALL_CAPABILITIES, c))) : [];
  }
  // Revoke wins (capabilitiesFor), so a capability in both is a revoke.
  grants = grants.filter((c) => !revokes.includes(c));

  // ── scope ──
  const currentScope: MemberScope = target.scope === 'artists' ? 'artists' : 'org';
  let scope: MemberScope;
  if (change.scope !== undefined && change.scope !== 'org' && change.scope !== 'artists') {
    return refuse(400, `Unknown scope "${change.scope}"`);
  }
  if (role === 'artist') {
    if (change.scope === 'org') return refuse(400, 'An artist is always limited to their own artists');
    scope = 'artists';
  } else if (role === 'owner' || role === 'admin') {
    if (change.scope === 'artists') return refuse(400, `An ${role} cannot be limited to some artists`);
    scope = 'org';
  } else {
    scope = (change.scope as MemberScope | undefined) ?? currentScope;
  }

  // ── nobody raises themselves ──
  // Judged on what the member could DO before and after, not on the fields:
  // an admin stepping down to member with a function is a step down (an
  // admin holds everything), though the function list grew.
  if (self) {
    const before = capabilitiesFor(orgKind, currentRole, target.functions, { grant: target.capGrants, revoke: target.capRevokes });
    const after = capabilitiesFor(orgKind, role, functions, { grant: grants, revoke: revokes });
    if ([...after].some((c) => !before.has(c))) return refuse(403, 'You cannot raise your own abilities');
    if (currentScope === 'artists' && scope === 'org') return refuse(403, 'You cannot widen your own scope');
  }

  // ── patch + the one audit event ──
  // One request is one event, so a failed audit write can never leave half
  // a change recorded. The verb names the most significant change (role,
  // then abilities, then scope); the payload carries every field that moved.
  const patch: MemberPatch = {};
  const changes: EventPayload = {};
  if (role !== currentRole) {
    patch.role = role;
    changes.role = { from: currentRole, to: role };
  }
  if (!sameSet(functions, target.functions)) {
    patch.functions = functions;
    changes.functions = { from: [...target.functions], to: functions };
  }
  if (!sameSet(grants, target.capGrants)) {
    patch.cap_grants = grants;
    changes.cap_grants = { from: [...target.capGrants], to: grants };
  }
  if (!sameSet(revokes, target.capRevokes)) {
    patch.cap_revokes = revokes;
    changes.cap_revokes = { from: [...target.capRevokes], to: revokes };
  }
  if (scope !== target.scope) {
    patch.scope = scope;
    changes.scope = { from: target.scope, to: scope };
  }
  const verb: MemberEvent['verb'] | null = patch.role
    ? 'member.role_changed'
    : patch.functions || patch.cap_grants || patch.cap_revokes
      ? 'member.capabilities_changed'
      : patch.scope
        ? 'member.scope_changed'
        : null;
  return { ok: true, noop: verb === null, patch, event: verb ? { verb, payload: changes } : null };
}

export function planMemberRemoval(
  actor: MemberActor,
  target: Pick<MemberState, 'userId' | 'role'>,
  ownerCount: number,
): { ok: true } | Refusal {
  if (target.role === 'owner') {
    if (actor.role !== 'owner') return refuse(403, 'Only an owner can remove an owner');
    if (ownerCount <= 1) return refuse(409, LAST_OWNER);
  }
  return { ok: true };
}

// ── Per-member switches (the members page) ──────────────────────────────

/** The abilities an owner/admin may switch on or off for a member of this role. */
export function switchableCapabilities(orgKind: OrgKind, role: Role): Capability[] {
  if (!ROLE_TAKES_OVERRIDES[role]) return [];
  return ALL_CAPABILITIES.filter((c) => KIND_CEILING[orgKind].includes(c) && !NEVER_GRANTABLE[role].includes(c));
}

/** `cap` and every narrower capability it (transitively) implies. */
function impliedBy(cap: Capability): Set<Capability> {
  const out = new Set<Capability>();
  const queue: Capability[] = [cap];
  while (queue.length) {
    const c = queue.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    queue.push(...(IMPLIES[c] ?? []));
  }
  return out;
}

/**
 * Flip one switch and return the new overrides, kept minimal: on clears any
 * revoke standing in the way (including of what it needs) and grants only
 * what the preset lacks; off drops grants that need it and revokes only what
 * would otherwise remain.
 */
export function toggleCapability(
  orgKind: OrgKind,
  role: Role,
  functions: readonly string[],
  overrides: CapabilityOverrides,
  cap: Capability,
  on: boolean,
): { grant: Capability[]; revoke: Capability[] } {
  const known = (l: readonly string[] | null | undefined) =>
    dedupe((l ?? []).filter((c): c is Capability => knownIn(ALL_CAPABILITIES, c)));
  let grant = known(overrides.grant);
  let revoke = known(overrides.revoke);
  const has = () => capabilitiesFor(orgKind, role, functions, { grant, revoke }).has(cap);

  if (on) {
    const needed = impliedBy(cap);
    revoke = revoke.filter((c) => !needed.has(c));
    if (!has()) grant = dedupe([...grant, cap]);
  } else {
    grant = grant.filter((c) => !impliedBy(c).has(cap));
    if (has()) revoke = dedupe([...revoke, cap]);
  }
  return { grant, revoke };
}

/** What the members page calls each ability. */
export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  'catalog.read': 'See the catalogue',
  'catalog.write': 'Edit songs and projects',
  'audio.finished': 'Hear finished music',
  'audio.working': 'Hear working material',
  'review.write': 'Rate and review',
  'review.comment': 'Comment',
  'rights.read': 'See credits and splits',
  'rights.read.own_line': 'See own credit line',
  'rights.write': 'Edit credits and splits',
  'contracts.read': 'Open contracts',
  'release.write': 'Edit releases',
  'release.approve.master': 'Approve masters',
  'release.approve.artwork': 'Approve artwork',
  'release.approve.legal': 'Approve legal',
  'release.approve.marketing': 'Approve marketing',
  'release.approve.metadata': 'Approve metadata',
  'tasks.write': 'Create tasks',
  'share.external': 'Share outside the org',
  'members.manage': 'Manage members',
  'org.manage': 'Organization settings',
  'finance.read': 'See finance',
  'business.read.internal': 'Business-internal notes',
};

export function isOrgKind(v: unknown): v is OrgKind {
  return knownIn(ORG_KINDS, v);
}

/**
 * The roles the members page offers for one member: the current role, plus
 * every role `planMemberChange` would accept from this actor. One rule, so
 * the dropdown never offers a change the route refuses.
 */
export function assignableRoles(orgKind: OrgKind, actor: MemberActor, target: MemberState, ownerCount: number): Role[] {
  return ROLES_BY_ORG_KIND[orgKind].filter(
    (r) => r === target.role || planMemberChange(orgKind, actor, target, { role: r }, ownerCount).ok,
  );
}
