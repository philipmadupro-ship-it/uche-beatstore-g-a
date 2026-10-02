/**
 * Server-side org access checks for Label OS routes (`/api/org/*`), which
 * bypass RLS through the service role exactly like the producer routes do
 * (06-permission-model.md §3.2). This is the org twin of ./ownership.ts:
 * resolve the session, read the caller's membership, and either return the
 * admin client plus a member context, or a NextResponse to bail with.
 *
 * access(user, object, action) =
 *     member(user, object.org)                 — requireOrgMember
 *   ∧ capability(kind, role, functions) ∋ cap  — requireOrgCapability
 *   ∧ inScope(user, object.contact, project)   — requireObjectAccess
 *
 * Rules this module holds:
 *  - Membership is read LIVE from `org_members` on every call. Nothing is
 *    cached in the JWT or a cookie, so removing a member, changing a role or
 *    soft-deleting the org takes effect on the next request (06 §5).
 *  - The capability set comes from `capabilitiesFor` (lib/labelos), the same
 *    table `has_org_cap` mirrors in SQL. Routes check capabilities, never role
 *    names.
 *  - A Label OS route never filters by `user_id` (the producer app's tenancy).
 *    It scopes by `org_id` through these helpers; `scopedOrgQuery` is the read
 *    path. org-api-source-guard.test.ts enforces it under src/app/api/org.
 *  - Status codes: 401 no session · 403 not a member of the org the route
 *    names, or lacking the capability · 404 the object is missing — which, for
 *    an object addressed by id, includes "in an org you are not in" and "a
 *    producer row (org_id IS NULL)", so an id never reveals that something
 *    exists in another tenant. Never 200 across orgs.
 *
 * Artist scope (`org_members.scope = 'artists'`) is a no-op until LABEL-10
 * adds `member_artist_scopes` / `can_see_artist`; see `artistScopeAllows`.
 */
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient, type AdminClient, type OwnershipFail } from '@/lib/auth/ownership';
import {
  ORG_KINDS,
  ROLES,
  ROLES_BY_ORG_KIND,
  capabilitiesFor,
  type Capability,
  type OrgKind,
  type Role,
} from '@/lib/labelos/capabilities';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

const log = createLogger('lib.auth.org-access');

export type OrgAccessOk = {
  ok: true;
  userId: string;
  admin: AdminClient;
  orgId: string;
  orgKind: OrgKind;
  role: Role;
  /** `org` sees every artist; `artists` only those in member_artist_scopes (LABEL-10). */
  scope: 'org' | 'artists';
  capabilities: ReadonlySet<Capability>;
};
export type OrgAccessResult = OrgAccessOk | OwnershipFail;

/** The parts of an access context the query and event helpers need. */
export type OrgContext = Pick<OrgAccessOk, 'orgId' | 'userId' | 'scope'>;

function fail(status: 401 | 403 | 404 | 500, error: string): OwnershipFail {
  return { ok: false, res: NextResponse.json({ error }, { status }) };
}

const NOT_AUTHENTICATED = () => fail(401, 'Not authenticated');
const FORBIDDEN = () => fail(403, 'Forbidden');
const NOT_FOUND = () => fail(404, 'Not found');

export type SessionIdentity = { userId: string; email: string | null };

/**
 * The signed-in caller, or null. For the one Label OS route a NON-member may
 * reach (`/api/org/join`, LABEL-08), which authorises by invitation rather
 * than membership. Every other route uses the require* helpers below.
 */
export async function sessionIdentity(): Promise<SessionIdentity | null> {
  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user?.id) return null;
  return { userId: user.id, email: typeof user.email === 'string' ? user.email : null };
}

async function sessionUserId(): Promise<string | null> {
  return (await sessionIdentity())?.userId ?? null;
}

type MembershipRow = {
  role: string;
  functions: string[] | null;
  scope: string;
  cap_grants: string[] | null;
  cap_revokes: string[] | null;
  organizations: { kind: string; deleted_at: string | null } | { kind: string; deleted_at: string | null }[] | null;
};

/**
 * The caller's live membership of one org, or null when they are not a
 * member, the org does not exist, or it is soft-deleted (mirrors
 * `public.org_role`). Throws on a database error.
 */
async function readMembership(
  admin: AdminClient,
  orgId: string,
  userId: string,
): Promise<Omit<OrgAccessOk, 'ok' | 'admin' | 'userId' | 'orgId'> | null> {
  const { data, error } = await admin
    .from('org_members')
    .select('role, functions, scope, cap_grants, cap_revokes, organizations!inner(kind, deleted_at)')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as MembershipRow | null;
  if (!row) return null;

  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  if (!org || org.deleted_at) return null;

  // An unknown kind, or a role the kind does not offer, is not a usable
  // membership (capabilitiesFor would grant it nothing anyway). A member whose
  // functions grant nothing IS still a member, so this is not a size check.
  const kind = ORG_KINDS.find((k) => k === org.kind);
  const role = ROLES.find((r) => r === row.role);
  if (!kind || !role || !ROLES_BY_ORG_KIND[kind].includes(role)) return null;

  const capabilities = capabilitiesFor(kind, role, row.functions, {
    grant: row.cap_grants,
    revoke: row.cap_revokes,
  });

  return {
    orgKind: kind,
    role,
    // The CHECK constraint allows only these two; anything else is narrowest.
    scope: row.scope === 'org' && role !== 'artist' ? 'org' : 'artists',
    capabilities,
  };
}

async function memberContext(
  userId: string,
  orgId: string,
  missing: () => OwnershipFail,
): Promise<OrgAccessResult> {
  const admin = createServiceClient();
  let membership: Awaited<ReturnType<typeof readMembership>>;
  try {
    membership = await readMembership(admin, orgId, userId);
  } catch (err) {
    log.error('membership read failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
  if (!membership) return missing();
  return { ok: true, userId, admin, orgId, ...membership };
}

/**
 * Resolve the caller and confirm they are a member of `orgId` (the org the
 * route names). 401 without a session; 403 when not a member — including an
 * org that does not exist or is soft-deleted, so the two cannot be told apart.
 */
export async function requireOrgMember(orgId: string): Promise<OrgAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(orgId)) return FORBIDDEN();
  return memberContext(userId, orgId, FORBIDDEN);
}

/**
 * `userId`'s live membership of `orgId` (role + capabilities), or null when
 * they are not a member, the org is gone, or the read fails. For
 * `/api/org/join`, which runs for a caller who may not be a member of
 * anything and also asks about a third person (the inviter), so the
 * require* helpers — which answer for the session, with 403s — do not fit.
 */
export async function liveMembership(
  admin: AdminClient,
  orgId: string,
  userId: string,
): Promise<{ role: Role; capabilities: ReadonlySet<Capability> } | null> {
  if (!isUUID(orgId) || !isUUID(userId)) return null;
  try {
    const m = await readMembership(admin, orgId, userId);
    return m ? { role: m.role, capabilities: m.capabilities } : null;
  } catch {
    return null;
  }
}

/** requireOrgMember, plus the capability. 403 when the member lacks it. */
export async function requireOrgCapability(orgId: string, cap: Capability): Promise<OrgAccessResult> {
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access;
  if (!access.capabilities.has(cap)) return FORBIDDEN();
  return access;
}

// ── Objects ─────────────────────────────────────────────────────────────

/**
 * Tables an org object can be addressed in, and which of their columns carry
 * the two scope keys (06 §2.5, 17 R3). Every one carries `org_id`; the tables
 * from main gain it in LABEL-10/12 (contacts, tracks, projects) and with the
 * tasks that extend them (17 R2, R5). Until a table has `org_id`, the read
 * errors and the helper answers 500 — fail closed.
 *
 * `contact` is the roster artist (R3: an artist is a contact). It is NOT
 * `project_comments.contact_id`, which is the portal commenter.
 * `activity_events` still names its column `artist_id` (migration 136).
 */
export const ORG_OBJECT_TABLES = {
  contacts: { contact: 'id', project: null },
  projects: { contact: null, project: 'id' },
  tracks: { contact: null, project: null },
  project_assets: { contact: null, project: 'project_id' },
  project_comments: { contact: null, project: 'project_id' },
  activity_events: { contact: 'artist_id', project: 'project_id' },
  org_invitations: { contact: null, project: 'project_id' },
} as const satisfies Record<string, { contact: string | null; project: string | null }>;

export type OrgObjectTable = keyof typeof ORG_OBJECT_TABLES;

export type OrgObject = {
  table: OrgObjectTable;
  id: string;
  orgId: string;
  contactId: string | null;
  projectId: string | null;
};

export type ObjectAccessResult = (OrgAccessOk & { object: OrgObject }) | OwnershipFail;

/**
 * Artist scope (06 §2.5). A no-op until LABEL-10, which adds
 * `member_artist_scopes` and makes this read it: an `artists`-scoped member
 * will then see only objects whose contact is in their list, and objects with
 * no contact not at all.
 */
function artistScopeAllows(_access: OrgAccessOk, _object: OrgObject): boolean {
  return true;
}

/**
 * Load an object's `org_id` (and its contact / project scope keys), then
 * check membership of THAT org, the capability, and scope. The org is always
 * read from the row; `orgId`, when the route has one in its path, must match
 * it, so `/api/org/A/…/<id of a row in B>` is 404 even to a member of both.
 */
export async function requireObjectAccess(opts: {
  table: OrgObjectTable;
  id: string;
  cap: Capability;
  orgId?: string;
}): Promise<ObjectAccessResult> {
  const { table, id, cap, orgId } = opts;
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(id)) return NOT_FOUND();

  const cols = ORG_OBJECT_TABLES[table];
  const scopeCols: (string | null)[] = [cols.contact, cols.project];
  const select = ['org_id', ...new Set(scopeCols.filter((c): c is string => !!c))];
  const admin = createServiceClient();
  const { data, error } = await admin.from(table).select(select.join(', ')).eq('id', id).maybeSingle();
  if (error) {
    log.error('object read failed', { table, id, error: error.message });
    return fail(500, 'Could not check organization access');
  }
  const row = data as Record<string, unknown> | null;
  if (!row) return NOT_FOUND();

  const rowOrg = row.org_id;
  // A producer row (org_id IS NULL) is never visible through Label OS (R11).
  if (typeof rowOrg !== 'string' || !isUUID(rowOrg)) return NOT_FOUND();
  // uuids compare case-insensitively; Postgres returns them lowercase.
  if (orgId !== undefined && orgId.toLowerCase() !== rowOrg.toLowerCase()) return NOT_FOUND();

  const access = await memberContext(userId, rowOrg, NOT_FOUND);
  if (!access.ok) return access;
  if (!access.capabilities.has(cap)) return FORBIDDEN();

  const key = (col: string | null) => {
    const v = col ? row[col] : null;
    return typeof v === 'string' ? v : null;
  };
  const object: OrgObject = {
    table,
    id,
    orgId: rowOrg,
    contactId: key(cols.contact),
    projectId: key(cols.project),
  };
  if (!artistScopeAllows(access, object)) return NOT_FOUND();
  return { ...access, object };
}

/**
 * A read of `table` pre-filtered to the context's org (and, from LABEL-10,
 * its artist scope). Chain further filters on the result. The context must
 * come from one of the require* helpers above, so the org was authorised.
 */
export function scopedOrgQuery(
  admin: AdminClient,
  table: string,
  ctx: OrgContext,
  columns = '*',
  options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
) {
  return admin.from(table).select(columns, options).eq('org_id', ctx.orgId);
}

// ── Member rows (LABEL-09) ──────────────────────────────────────────────

/**
 * One `org_members` row, addressed by (org, user): the org from the
 * authorised context, the user from the request. This is the only place a
 * Label OS route reaches a row by `user_id` — routes under src/app/api/org
 * may not filter on it themselves (org-api-source-guard.test.ts), because
 * there `user_id` is a member's identity, never the tenant.
 *
 * Reads need only the context (it is already a member of the org). Writes
 * need `members.manage` on it; asking without throws, a programming error,
 * which the route's try/catch turns into a 500 rather than a write.
 */
export function memberRowQuery(admin: AdminClient, ctx: OrgAccessOk, userId: string) {
  if (!isUUID(userId)) throw new Error('memberRowQuery: userId is not a uuid');
  const write = () => {
    if (!ctx.capabilities.has('members.manage')) throw new Error('memberRowQuery: members.manage is required to write');
  };
  return {
    select: (columns = '*') =>
      admin.from('org_members').select(columns).eq('org_id', ctx.orgId).eq('user_id', userId),
    update: (patch: Record<string, unknown>) => {
      write();
      return admin.from('org_members').update(patch).eq('org_id', ctx.orgId).eq('user_id', userId);
    },
    delete: () => {
      write();
      return admin.from('org_members').delete().eq('org_id', ctx.orgId).eq('user_id', userId);
    },
  };
}

// ── The caller's orgs (LABEL-09) ────────────────────────────────────────

export type MyOrg = { id: string; name: string; slug: string; kind: OrgKind; role: Role };

type MyOrgRow = {
  role: string;
  organizations:
    | { id: string; name: string; slug: string; kind: string; deleted_at: string | null }
    | { id: string; name: string; slug: string; kind: string; deleted_at: string | null }[]
    | null;
};

/** The producer is the user with a creator_profiles row (as src/proxy.ts decides). */
async function isProducerUser(admin: AdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('creator_profiles').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * Every live org the signed-in caller belongs to, for the org switcher
 * (`GET /api/org`). The caller's own memberships — identity, not tenancy —
 * which is why this read lives here and not in the route. A soft-deleted
 * org, an unknown kind or a role the kind does not offer is left out, the
 * same memberships `readMembership` refuses.
 */
export async function myOrganizations(): Promise<
  { ok: true; userId: string; isProducer: boolean; orgs: MyOrg[] } | OwnershipFail
> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  const admin = createServiceClient();
  try {
    const [{ data, error }, isProducer] = await Promise.all([
      admin.from('org_members').select('role, organizations!inner(id, name, slug, kind, deleted_at)').eq('user_id', userId),
      isProducerUser(admin, userId),
    ]);
    if (error) throw new Error(error.message);
    const orgs: MyOrg[] = [];
    for (const row of (data ?? []) as MyOrgRow[]) {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      if (!org || org.deleted_at) continue;
      const kind = ORG_KINDS.find((k) => k === org.kind);
      const role = ROLES.find((r) => r === row.role);
      if (!kind || !role || !ROLES_BY_ORG_KIND[kind].includes(role)) continue;
      orgs.push({ id: org.id, name: org.name, slug: org.slug, kind, role });
    }
    orgs.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
    return { ok: true, userId, isProducer, orgs };
  } catch (err) {
    log.error('org list failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not list organizations');
  }
}

export type OrgShell = {
  org: { id: string; name: string; slug: string; kind: OrgKind };
  role: Role;
  scope: 'org' | 'artists';
  capabilities: Capability[];
  viewerIsProducer: boolean;
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The org shell for `/o/<slug>` (the (label) layout, a server component):
 * the org by slug and the caller's live membership of it. Null when there is
 * no session, no such live org, or the caller is not a member — the page
 * answers 404 for all three, so a slug never reveals that an org exists.
 */
export async function orgShellFor(slug: string): Promise<OrgShell | null> {
  if (!SLUG_RE.test(slug) || slug.length > 80) return null;
  const userId = await sessionUserId();
  if (!userId) return null;
  const admin = createServiceClient();
  try {
    const { data, error } = await admin
      .from('organizations')
      .select('id, name, slug, kind')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const org = data as { id: string; name: string; slug: string; kind: string } | null;
    if (!org) return null;
    const [membership, viewerIsProducer] = await Promise.all([
      readMembership(admin, org.id, userId),
      isProducerUser(admin, userId),
    ]);
    if (!membership) return null;
    return {
      org: { id: org.id, name: org.name, slug: org.slug, kind: membership.orgKind },
      role: membership.role,
      scope: membership.scope,
      capabilities: [...membership.capabilities],
      viewerIsProducer,
    };
  } catch (err) {
    log.error('org shell read failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
