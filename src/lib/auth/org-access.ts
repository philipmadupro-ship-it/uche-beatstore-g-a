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
 * Is `userId` a live member of `orgId`? For `/api/org/join`'s preview, which
 * runs for a caller who may not be a member of anything (so the require*
 * helpers, which answer 403, do not fit). Same live read as they do; false on
 * any error.
 */
export async function isLiveOrgMember(admin: AdminClient, orgId: string, userId: string): Promise<boolean> {
  if (!isUUID(orgId) || !isUUID(userId)) return false;
  try {
    return (await readMembership(admin, orgId, userId)) !== null;
  } catch {
    return false;
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
