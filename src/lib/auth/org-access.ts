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
 * External project members (LABEL-21, 06 §2.6): a person with their own
 * account admitted to ONE org project holds a `project_members` row and no
 * `org_members` row, so every helper above answers "not a member" for them
 * by itself — the default is deny. The routes that DO serve them (the
 * allowlist in lib/labelos/external-routes) go through the helpers at the
 * bottom: `requireExternalProject` / `requireExternalTrack` for them alone,
 * `requireProjectActor` / `requireTrackActor` for a route that serves org
 * members and external members. The membership is read LIVE on every call
 * (no cache), so removing it or letting it expire takes effect on the next
 * request. Never an `org_members` lookup for an external member, never a
 * widening of an org capability: what a role may do is `externalCan`.
 *
 * Artist ↔ label connection (LABEL-41, D1): a LABEL member may read, and only
 * read, the music an ARTIST org shared with their label. The helpers at the
 * bottom (`requireConnectedTrack` / `requireConnectedProject` /
 * `requireConnectionOfLabel`) are an explicit opt-in per route, never folded
 * into requireObjectAccess: every other route keeps answering 404 for a row
 * of another org, so a write route can never be reached through a
 * connection by accident. They answer for the LABEL org the route names:
 * live label membership, an ACTIVE connection to the row's org, the row in a
 * shared project, the member's OWN artist scope on the connection's roster
 * contact, and `catalog.read` — then the route applies D4 with the member's
 * own capabilities. Any refusal is 404 (never 403): what the artist org holds
 * is not theirs to learn. Ending the connection, narrowing the share or
 * soft-deleting either org takes effect on the next request (read live).
 *
 * Entitlements (LABEL-47, migration 170): what the platform operator licensed
 * the org (lib/labelos/entitlements). Read LIVE with the membership. A
 * capability a module owns is removed from the member's set when the org
 * lacks the module, and asking for it — or for a module directly with
 * `requireOrgModule` — answers 404, not 403: a module the org was not
 * licensed does not exist for it. No row = everything the face allows.
 *
 * Artist scope (06 §2.5, LABEL-10): a member with `scope = 'artists'` (role
 * `artist` always) sees only the roster contacts in `member_artist_scopes`,
 * read live with the membership. requireObjectAccess answers 404 for an
 * object outside it (and for any object with no contact); scopedOrgQuery
 * narrows list reads to it. The rule is lib/labelos/artist-scope, the SQL
 * twin `public.can_see_artist` (migration 139).
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
import { artistScopeFilter, scopeAllowsAnyContact, scopeAllowsContact, toArtistScope, type ArtistScope } from '@/lib/labelos/artist-scope';
import { orgProjectScopeContacts } from '@/lib/labelos/org-read';
import { capabilityEntitled, entitledCapabilities, orgEntitlements, type Entitlements, type Module } from '@/lib/labelos/entitlements';
import { readEntitlementRow } from '@/lib/labelos/entitlements-store';
import {
  CONNECTED_CAPABILITY,
  CONNECTION_COLUMNS,
  connectionReachesAnyProject,
  connectionReachesProject,
  labelScopeReaches,
  toSharedSet,
  type ConnectionRow,
} from '@/lib/labelos/connections';
import { isMissingConnections } from '@/lib/labelos/audit-rpc';
import { externalMayAny, sortSharedProjects, sharedProjectHref, toMembership, type ExternalMembership, type ProjectMemberRow, type SharedProjectRef } from '@/lib/labelos/project-members';
import { REAUTH_WINDOW_MINUTES, canRestore, isFreshSignIn, purgeAfter } from '@/lib/labelos/org-lifecycle';
import { inChunks, pageAll, ReadError } from '@/lib/labelos/paged-read';
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
  /** The roster contacts this member sees: null = the whole org (lib/labelos/artist-scope). */
  artistScope: ArtistScope;
  capabilities: ReadonlySet<Capability>;
  /**
   * What the org is licensed for (LABEL-47). Always set by the helpers here;
   * optional only so hand-built contexts in tests keep compiling — absent
   * reads as the default (everything), exactly like an org without a row.
   */
  entitlements?: Entitlements;
};
export type OrgAccessResult = OrgAccessOk | OwnershipFail;

/** The parts of an access context the query and event helpers need. */
export type OrgContext = Pick<OrgAccessOk, 'orgId' | 'userId' | 'scope' | 'artistScope'>;

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
  const session = await readSession();
  return session ? { userId: session.userId, email: session.email } : null;
}

type SessionDetail = SessionIdentity & { lastSignInAt: string | null };

async function readSession(): Promise<SessionDetail | null> {
  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user?.id) return null;
  return {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    lastSignInAt: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
  };
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
): Promise<(Omit<OrgAccessOk, 'ok' | 'admin' | 'userId' | 'orgId' | 'artistScope' | 'entitlements'> & { entitlements: Entitlements }) | null> {
  // The licence depends only on the org, so it is read alongside the membership, not after it.
  const [{ data, error }, entitlementRow] = await Promise.all([
    admin
      .from('org_members')
      .select('role, functions, scope, cap_grants, cap_revokes, organizations!inner(kind, deleted_at)')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
    readEntitlementRow(admin, orgId),
  ]);
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

  const entitlements = orgEntitlements({ kind }, entitlementRow);
  const capabilities = entitledCapabilities(
    capabilitiesFor(kind, role, row.functions, { grant: row.cap_grants, revoke: row.cap_revokes }),
    entitlements.modules,
  );

  return {
    orgKind: kind,
    role,
    entitlements,
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
  let artistScope: ArtistScope;
  try {
    artistScope = await readArtistScope(admin, orgId, userId, membership);
  } catch (err) {
    log.error('artist scope read failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
  return { ok: true, userId, admin, orgId, ...membership, artistScope };
}

/**
 * The member's artist scope: null for the whole org, else the contacts in
 * member_artist_scopes (none = sees nothing). Read only when scoped; throws
 * on a database error so the caller fails closed.
 */
async function readArtistScope(
  admin: AdminClient,
  orgId: string,
  userId: string,
  membership: { role: Role; scope: 'org' | 'artists' },
): Promise<ArtistScope> {
  if (toArtistScope(membership.role, membership.scope, []) === null) return null;
  const { data, error } = await admin
    .from('member_artist_scopes')
    .select('contact_id')
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { contact_id: string | null }[];
  return toArtistScope(membership.role, membership.scope, rows.map((r) => r.contact_id));
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

/**
 * A member's access context for a caller with NO session: the one route
 * whose credential is a signed feed token (the release calendar, LABEL-34 —
 * a calendar app cannot send cookies). Same membership, role, capability and
 * artist-scope rules as `requireOrgMember`, read live on every call, plus
 * the membership's `joined_at` so a token can die when the person leaves and
 * rejoins. `none` = not a (live) member; `error` = could not tell, which the
 * route answers 5xx, never as "not a member". The TOKEN was already checked
 * by the caller; this does not authenticate anyone.
 */
export async function memberAccessFor(
  orgId: string,
  userId: string,
): Promise<(OrgAccessOk & { joinedAt: string }) | { ok: false; reason: 'none' | 'error' }> {
  if (!isUUID(orgId) || !isUUID(userId)) return { ok: false, reason: 'none' };
  const context = await memberContext(userId, orgId, NOT_FOUND);
  if (!context.ok) return { ok: false, reason: context.res.status === 404 ? 'none' : 'error' };
  const { data, error } = await context.admin
    .from('org_members')
    .select('joined_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    log.error('joined_at read failed', { orgId, error: error.message });
    return { ok: false, reason: 'error' };
  }
  const joinedAt = (data as { joined_at?: string } | null)?.joined_at;
  return joinedAt ? { ...context, joinedAt } : { ok: false, reason: 'none' };
}

/** Does the org of this context have the module? No entitlements on the context = the default (yes). */
export function orgHasModule(ctx: Pick<OrgAccessOk, 'entitlements'>, module: Module): boolean {
  return !ctx.entitlements || ctx.entitlements.modules.has(module);
}

/** 404 when `cap` belongs to a module the org is not licensed for, else 403. */
function refuseCapability(ctx: Pick<OrgAccessOk, 'entitlements'>, cap: Capability): OwnershipFail {
  return ctx.entitlements && !capabilityEntitled(cap, ctx.entitlements.modules) ? NOT_FOUND() : FORBIDDEN();
}

/**
 * requireOrgMember, plus the capability. 403 when the member lacks it; 404
 * when the capability belongs to a module the org is not licensed for.
 */
export async function requireOrgCapability(orgId: string, cap: Capability): Promise<OrgAccessResult> {
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access;
  if (!access.capabilities.has(cap)) return refuseCapability(access, cap);
  return access;
}

/**
 * requireOrgMember for a route that belongs to a module (LABEL-47): 404 when
 * the org is not licensed for it, whoever asks, before any capability is
 * looked at. With `cap`, then the capability (403 / 404 as requireOrgCapability).
 */
export async function requireOrgModule(orgId: string, module: Module, cap?: Capability): Promise<OrgAccessResult> {
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access;
  if (!orgHasModule(access, module)) return NOT_FOUND();
  if (cap && !access.capabilities.has(cap)) return refuseCapability(access, cap);
  return access;
}

// ── Owner-only lifecycle acts (LABEL-39) ────────────────────────────────

export type OrgOwnerOk = {
  ok: true;
  userId: string;
  email: string | null;
  admin: AdminClient;
  org: { id: string; name: string; slug: string; kind: string; deleted_at: string | null };
};
export type OrgOwnerResult = OrgOwnerOk | OwnershipFail;

/**
 * The caller as an OWNER of this org, for the acts only an owner may do:
 * export, delete, restore (06 §2.1 — "org deletion" is a role, not a
 * capability). Unlike requireOrgMember it can see a soft-deleted org, because
 * restoring one is the whole point of the grace period.
 *
 *  - `state: 'live'`    the org must not be soft-deleted (export, delete);
 *    `state: 'deleted'` it must be (restore). Anything else is 404, like an
 *    org that does not exist: these routes never confirm an org to someone
 *    who is not its owner.
 *  - `freshSignIn`: also require a sign-in within REAUTH_WINDOW_MINUTES (a
 *    fresh magic link). Failing it answers 403 `{ requiresReauth: true }`,
 *    which the settings page turns into "send me a link".
 *  - Not an owner (a member, an external project member, a stranger) is 403
 *    for a live org and 404 for a deleted one.
 */
export async function requireOrgOwner(
  orgId: string,
  opts: { state: 'live' | 'deleted'; freshSignIn: boolean },
): Promise<OrgOwnerResult> {
  if (!isUUID(orgId)) return opts.state === 'deleted' ? NOT_FOUND() : FORBIDDEN();
  const session = await readSession();
  if (!session) return NOT_AUTHENTICATED();
  const refused = () => (opts.state === 'deleted' ? NOT_FOUND() : FORBIDDEN());
  const admin = createServiceClient();
  try {
    const [{ data: member, error: memberErr }, { data: orgRow, error: orgErr }] = await Promise.all([
      admin.from('org_members').select('role').eq('org_id', orgId).eq('user_id', session.userId).maybeSingle(),
      admin.from('organizations').select('id, name, slug, kind, deleted_at').eq('id', orgId).maybeSingle(),
    ]);
    if (memberErr) throw new Error(memberErr.message);
    if (orgErr) throw new Error(orgErr.message);
    const org = orgRow as OrgOwnerOk['org'] | null;
    if (!org || (member as { role?: string } | null)?.role !== 'owner') return refused();
    // A live org asked for a deleted-only act (or the reverse) does not exist for this purpose.
    if ((opts.state === 'live') === (org.deleted_at !== null)) return NOT_FOUND();
    if (opts.freshSignIn && !isFreshSignIn(session.lastSignInAt)) {
      return {
        ok: false,
        res: NextResponse.json(
          { error: 'Sign in again to continue', requiresReauth: true, reauthWindowMinutes: REAUTH_WINDOW_MINUTES },
          { status: 403 },
        ),
      };
    }
    return { ok: true, userId: session.userId, email: session.email, admin, org };
  } catch (err) {
    log.error('owner check failed', { orgId, error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
}

/**
 * The soft-deleted org at `/o/<slug>` that the caller OWNS, for the layout to
 * send them to the restore page instead of a bare 404 (LABEL-39). Null for
 * everyone else — a member who is not an owner, a stranger, a live org, no
 * session — so a slug still never reveals that a deleted org exists.
 */
export async function ownedDeletedOrgFor(slug: string): Promise<{ id: string } | null> {
  if (!SLUG_RE.test(slug) || slug.length > 80) return null;
  const userId = await sessionUserId();
  if (!userId) return null;
  const admin = createServiceClient();
  try {
    const { data: org, error } = await admin.from('organizations').select('id, deleted_at').eq('slug', slug).maybeSingle();
    if (error) throw new Error(error.message);
    const row = org as { id: string; deleted_at: string | null } | null;
    if (!row || !row.deleted_at) return null;
    const { data: member, error: memberErr } = await admin
      .from('org_members')
      .select('role')
      .eq('org_id', row.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (memberErr) throw new Error(memberErr.message);
    return (member as { role?: string } | null)?.role === 'owner' ? { id: row.id } : null;
  } catch (err) {
    log.error('deleted org lookup failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
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
 *
 * `projects`, `tracks` and the project-keyed rows carry no contact column:
 * they reach their artists through projects (scopedThroughProjects below,
 * LABEL-12), the same path as the SQL `can_see_org_project` /
 * `can_see_org_track` (migration 141). scopedOrgQuery still lists none of
 * them to a scoped member; a list route for them must narrow by that path
 * first (`orgProjectIdsInScope`).
 *
 * `releases` (LABEL-16) carry their artist in `contact_id`, but who READS
 * one is decided by its project, as migration 144's policy does
 * (`can_see_org_project` on `project_id`), so the contact is deliberately
 * not its scope key here.
 */
export const ORG_OBJECT_TABLES = {
  contacts: { contact: 'id', project: null },
  projects: { contact: null, project: 'id' },
  tracks: { contact: null, project: null },
  project_assets: { contact: null, project: 'project_id' },
  project_comments: { contact: null, project: 'project_id' },
  activity_events: { contact: 'artist_id', project: 'project_id' },
  org_invitations: { contact: null, project: 'project_id' },
  releases: { contact: null, project: 'project_id' },
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
 * Artist scope (06 §2.5): an `artists`-scoped member sees only objects whose
 * roster contact is in their list, and objects with no contact not at all.
 */
function artistScopeAllows(access: OrgAccessOk, object: OrgObject): boolean {
  return scopeAllowsContact(access.artistScope, object.contactId);
}

/**
 * Tables whose artist is reached through projects (06 §2.5, 17 R1, LABEL-12):
 * projects and tracks, and every object table that has a project column but
 * no roster-contact column (project_assets, project_comments, …) — the same
 * paths as the SQL (`can_see_org_project`, `can_see_org_track`, the
 * org_member_read policies, migration 141).
 */
function scopedThroughProjects(table: OrgObjectTable): boolean {
  const cols = ORG_OBJECT_TABLES[table];
  return table === 'projects' || table === 'tracks' || (cols.contact === null && cols.project !== null);
}

/**
 * The roster contacts of the object's projects OF ITS ORG — a project
 * itself, every project a track sits in, or the project a row is keyed to:
 * inbox artist plus project_contacts (lib/labelos/org-read#orgProjectScopeContacts).
 * null when a read fails — the caller answers 500.
 */
async function artistsThroughProjects(
  admin: AdminClient,
  table: OrgObjectTable,
  id: string,
  orgId: string,
  row: Record<string, unknown>,
): Promise<string[] | null> {
  let projects: { id: string; inbox_for_contact_id: string | null }[];
  if (table === 'projects') {
    const inbox = row.inbox_for_contact_id;
    projects = [{ id, inbox_for_contact_id: typeof inbox === 'string' ? inbox : null }];
  } else {
    let ids: string[];
    if (table === 'tracks') {
      const links = await admin.from('project_tracks').select('project_id').eq('track_id', id);
      if (links.error) return null;
      ids = ((links.data ?? []) as { project_id: string }[]).map((l) => l.project_id);
    } else {
      const projectCol = ORG_OBJECT_TABLES[table].project;
      const projectId = projectCol ? row[projectCol] : null;
      ids = typeof projectId === 'string' ? [projectId] : [];
    }
    if (ids.length === 0) return [];
    const inOrg = await admin.from('projects').select('id, inbox_for_contact_id').in('id', ids).eq('org_id', orgId);
    if (inOrg.error) return null;
    projects = (inOrg.data ?? []) as typeof projects;
  }
  if (projects.length === 0) return [];
  const linked = await admin
    .from('project_contacts')
    .select('contact_id')
    .in('project_id', projects.map((p) => p.id));
  if (linked.error) return null;
  const contactIds = ((linked.data ?? []) as { contact_id: string | null }[]).map((c) => c.contact_id);
  // Every project's inbox artist, plus every linked contact (once).
  return orgProjectScopeContacts({ inbox_for_contact_id: null }, [...projects.map((p) => p.inbox_for_contact_id), ...contactIds]);
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
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  return objectAccessFor(userId, opts);
}

/**
 * `requireObjectAccess` for a user other than the session's: the same
 * membership, artist-scope and capability rules, answered for `userId`.
 * For a route that must know whether ANOTHER member may reach an object
 * before it hands them something about it (an assigned task, LABEL-23); the
 * caller never reveals the answer's reason, only "no".
 */
export async function objectAccessFor(
  userId: string,
  opts: { table: OrgObjectTable; id: string; cap: Capability; orgId?: string },
): Promise<ObjectAccessResult> {
  const { table, id, cap, orgId } = opts;
  if (!isUUID(userId)) return NOT_AUTHENTICATED();
  if (!isUUID(id)) return NOT_FOUND();

  const cols = ORG_OBJECT_TABLES[table];
  const scopeCols: (string | null)[] = [cols.contact, cols.project];
  const select = ['org_id', ...new Set(scopeCols.filter((c): c is string => !!c))];
  if (table === 'projects') select.push('inbox_for_contact_id');
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
  // Scope before capability: an object outside the member's artists is 404
  // whatever they may do, so a 403 never confirms that it exists.
  if (scopedThroughProjects(table) && access.artistScope !== null) {
    const artists = await artistsThroughProjects(admin, table, id, rowOrg, row);
    if (artists === null) {
      log.error('artist scope lookup failed', { table, id });
      return fail(500, 'Could not check organization access');
    }
    if (!scopeAllowsAnyContact(access.artistScope, artists)) return NOT_FOUND();
  } else if (!artistScopeAllows(access, object)) {
    return NOT_FOUND();
  }
  if (!access.capabilities.has(cap)) return refuseCapability(access, cap);
  return { ...access, object };
}

/**
 * The org projects a member's artist scope reaches (inbox artist or a
 * project_contacts contact in scope — the TS twin of `can_see_org_project`),
 * for list routes over project-keyed tables. null = the whole org (no
 * narrowing); [] = nothing. Throws when a read fails.
 */
export async function orgProjectIdsInScope(admin: AdminClient, ctx: OrgContext): Promise<string[] | null> {
  if (ctx.artistScope === null) return null;
  const contacts = [...ctx.artistScope];
  if (contacts.length === 0) return [];
  // Paged and chunked: PostgREST cuts a response at max-rows without an error (a scoped member would
  // silently lose projects), and a catalogue-sized `in (…)` list overruns the request line.
  const scopeRead = <T>(what: string, read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
    pageAll<T>(read, what).catch((err: unknown) => {
      throw new Error(`Scope lookup failed: ${err instanceof ReadError ? err.raw.message : String(err)}`);
    });
  const [inbox, linked] = await Promise.all([
    scopeRead<{ id: string }>('inbox read', (from, to) =>
      admin.from('projects').select('id').eq('org_id', ctx.orgId).in('inbox_for_contact_id', contacts).order('id').range(from, to)),
    scopeRead<{ project_id: string }>('link read', (from, to) =>
      admin.from('project_contacts').select('project_id').in('contact_id', contacts).order('project_id').order('contact_id').range(from, to)),
  ]);
  const ids = new Set(inbox.map((p) => p.id));
  const linkedIds = [...new Set(linked.map((l) => l.project_id))];
  if (linkedIds.length > 0) {
    // A contact of this org can only be linked to this org's projects (141's
    // trigger), but the read is scoped to the org all the same.
    const inOrg = await inChunks<{ id: string }>(
      linkedIds,
      (part, from, to) => admin.from('projects').select('id').eq('org_id', ctx.orgId).in('id', part).order('id').range(from, to),
      'project read',
    ).catch((err: unknown) => {
      throw new Error(`Scope lookup failed: ${err instanceof ReadError ? err.raw.message : String(err)}`);
    });
    for (const p of inOrg) ids.add(p.id);
  }
  return [...ids].sort();
}

/**
 * A read of `table` pre-filtered to the context's org and, for an org object
 * table (ORG_OBJECT_TABLES), to the member's artist scope. Org-level tables
 * (org_members, member_artist_scopes) are not artist-scoped. Chain further
 * filters on the result. The context must come from one of the require*
 * helpers above, so the org was authorised.
 */
export function scopedOrgQuery(
  admin: AdminClient,
  table: string,
  ctx: OrgContext,
  columns = '*',
  options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
) {
  const query = admin.from(table).select(columns, options).eq('org_id', ctx.orgId);
  if (!(table in ORG_OBJECT_TABLES)) return query;
  const filter = artistScopeFilter(ctx.artistScope, ORG_OBJECT_TABLES[table as OrgObjectTable].contact);
  if (filter.kind === 'in') return query.in(filter.column, filter.values);
  // Nothing in scope: a filter no row can satisfy alongside the org filter
  // above (org_id = X AND org_id IS NULL), so the read stays a normal query
  // the route can chain on, and returns nothing.
  if (filter.kind === 'none') return query.is('org_id', null);
  return query;
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

/**
 * One member's artist scope rows (`member_artist_scopes`), addressed by
 * (org, user) like `memberRowQuery`, for the same reason. Reads need only
 * the context; replacing the list needs `members.manage` (throws without).
 * The same-org trigger (139) refuses a contact of another org.
 */
export function memberArtistScopeQuery(admin: AdminClient, ctx: OrgAccessOk, userId: string) {
  if (!isUUID(userId)) throw new Error('memberArtistScopeQuery: userId is not a uuid');
  const rows = () => admin.from('member_artist_scopes');
  const select = () => rows().select('contact_id').eq('org_id', ctx.orgId).eq('user_id', userId);
  return {
    select,
    /** The list as sorted, lower-cased ids. Throws on a database error. */
    list: async (): Promise<string[]> => {
      const { data, error } = await select();
      if (error) throw new Error(error.message);
      return ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id.toLowerCase()).sort();
    },
    /**
     * Make the list exactly `contactIds`. Drops what is not wanted FIRST, then
     * adds what is missing: a failure between the two leaves the member with
     * less than either list, never more (fail narrow; the route then puts the
     * old list back).
     */
    replace: async (contactIds: readonly string[]): Promise<{ error: { message: string } | null }> => {
      if (!ctx.capabilities.has('members.manage')) throw new Error('memberArtistScopeQuery: members.manage is required to write');
      const ids = [...new Set(contactIds.map((c) => c.toLowerCase()))];
      if (ids.some((id) => !isUUID(id))) throw new Error('memberArtistScopeQuery: contact ids must be uuids');
      let drop = rows().delete().eq('org_id', ctx.orgId).eq('user_id', userId);
      if (ids.length > 0) drop = drop.not('contact_id', 'in', `(${ids.join(',')})`);
      const { error: dropErr } = await drop;
      if (dropErr) return { error: dropErr };
      if (ids.length === 0) return { error: null };
      const { error } = await rows().upsert(
        ids.map((contact_id) => ({ org_id: ctx.orgId, user_id: userId, contact_id })),
        { onConflict: 'org_id,user_id,contact_id', ignoreDuplicates: true },
      );
      return { error: error ?? null };
    },
  };
}

// ── The caller's orgs (LABEL-09) ────────────────────────────────────────

export type MyOrg = { id: string; name: string; slug: string; kind: OrgKind; role: Role };
/** An org the caller OWNS that is inside its 30-day grace period (LABEL-39): restorable at /restore/<id>. */
export type PendingDeletion = { id: string; name: string; purgeAfter: string };

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
 * org is not listed (it is `pendingDeletion` for its owner, who can restore
 * it); an unknown kind or a role the kind does not offer is left out, the
 * same memberships `readMembership` refuses.
 */
export async function myOrganizations(): Promise<
  { ok: true; userId: string; isProducer: boolean; orgs: MyOrg[]; pendingDeletion: PendingDeletion[] } | OwnershipFail
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
    const pendingDeletion: PendingDeletion[] = [];
    for (const row of (data ?? []) as MyOrgRow[]) {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      if (org?.deleted_at) {
        // Only an owner can bring it back, and only while the grace period lasts.
        const due = purgeAfter(org.deleted_at);
        if (row.role === 'owner' && canRestore(org.deleted_at) && due) pendingDeletion.push({ id: org.id, name: org.name, purgeAfter: due.toISOString() });
        continue;
      }
      if (!org) continue;
      const kind = ORG_KINDS.find((k) => k === org.kind);
      const role = ROLES.find((r) => r === row.role);
      if (!kind || !role || !ROLES_BY_ORG_KIND[kind].includes(role)) continue;
      orgs.push({ id: org.id, name: org.name, slug: org.slug, kind, role });
    }
    orgs.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
    pendingDeletion.sort((a, b) => a.purgeAfter.localeCompare(b.purgeAfter));
    return { ok: true, userId, isProducer, orgs, pendingDeletion };
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
  /** The modules the org is licensed for (LABEL-47); the nav hides the rest. */
  modules: Module[];
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
      modules: [...membership.entitlements.modules],
      viewerIsProducer,
    };
  } catch (err) {
    log.error('org shell read failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}


// ── External project members (LABEL-21) ─────────────────────────────────

/**
 * What an external member's request is answerable for: the org the project
 * (or track) belongs to, and the member's LIVE membership of each shared
 * project involved — one for a project, every shared project a track sits in
 * for a track. No capabilities: `externalCan` answers per action.
 */
export type ExternalAccessOk = {
  ok: true;
  userId: string;
  admin: AdminClient;
  orgId: string;
  memberships: ExternalMembership[];
};
export type ExternalAccessResult = ExternalAccessOk | OwnershipFail;

type MemberRowWithOrg = ProjectMemberRow & {
  organizations: { deleted_at: string | null } | { deleted_at: string | null }[] | null;
};

/**
 * `userId`'s live memberships in `orgId`, optionally narrowed to some
 * projects: not expired, org not soft-deleted, a known role. Throws on a
 * database error so the caller fails closed (500), like readMembership.
 */
async function readExternalMemberships(
  admin: AdminClient,
  userId: string,
  orgId: string,
  projectIds?: readonly string[],
): Promise<ExternalMembership[]> {
  if (projectIds && projectIds.length === 0) return [];
  let q = admin
    .from('project_members')
    .select('project_id, role, allow_downloads, expires_at, organizations!inner(deleted_at)')
    .eq('user_id', userId)
    .eq('org_id', orgId);
  if (projectIds) q = q.in('project_id', [...projectIds]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: ExternalMembership[] = [];
  for (const row of (data ?? []) as unknown as MemberRowWithOrg[]) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org || org.deleted_at) continue;
    const m = toMembership(row);
    if (m) out.push(m);
  }
  return out;
}

/** The org of a project row, or null when it is missing or a producer project (org_id NULL). */
async function projectOrg(admin: AdminClient, projectId: string): Promise<{ orgId: string | null; error: boolean }> {
  const { data, error } = await admin.from('projects').select('org_id').eq('id', projectId).maybeSingle();
  if (error) {
    log.error('project read failed', { projectId, error: error.message });
    return { orgId: null, error: true };
  }
  const org = (data as { org_id?: unknown } | null)?.org_id;
  return { orgId: typeof org === 'string' && isUUID(org) ? org : null, error: false };
}

/**
 * The caller as an external member of THIS project, for a route that serves
 * them. 401 without a session; 404 for everything else — a malformed id, a
 * missing or producer project, another org's project (when the route names
 * an org), a project they are not a live member of. Never 403: whether the
 * project exists is not theirs to learn.
 */
export async function requireExternalProject(opts: { projectId: string; orgId?: string }): Promise<ExternalAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(opts.projectId)) return NOT_FOUND();
  const admin = createServiceClient();
  try {
    const { orgId: org, error } = await projectOrg(admin, opts.projectId);
    if (error) return fail(500, 'Could not check project access');
    if (!org) return NOT_FOUND();
    if (opts.orgId !== undefined && opts.orgId.toLowerCase() !== org.toLowerCase()) return NOT_FOUND();
    const memberships = await readExternalMemberships(admin, userId, org, [opts.projectId]);
    if (memberships.length === 0) return NOT_FOUND();
    return { ok: true, userId, admin, orgId: org, memberships };
  } catch (err) {
    log.error('external project access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check project access');
  }
}

/**
 * The caller as an external member reaching this TRACK: it is an org track
 * (org_id set, matching the route's org) that sits in at least one project
 * they are a live member of. A track in no shared project of theirs is 404,
 * even one in the same org or the same song's other projects.
 */
export async function requireExternalTrack(opts: { trackId: string; orgId?: string }): Promise<ExternalAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(opts.trackId)) return NOT_FOUND();
  const admin = createServiceClient();
  try {
    const { data, error } = await admin.from('tracks').select('org_id').eq('id', opts.trackId).maybeSingle();
    if (error) {
      log.error('track read failed', { trackId: opts.trackId, error: error.message });
      return fail(500, 'Could not check project access');
    }
    const row = data as { org_id?: unknown } | null;
    if (!row) return NOT_FOUND();
    const org = typeof row.org_id === 'string' && isUUID(row.org_id) ? row.org_id : null;
    if (!org) return NOT_FOUND();
    if (opts.orgId !== undefined && opts.orgId.toLowerCase() !== org.toLowerCase()) return NOT_FOUND();

    const links = await admin.from('project_tracks').select('project_id').eq('track_id', opts.trackId);
    if (links.error) {
      log.error('project link read failed', { trackId: opts.trackId, error: links.error.message });
      return fail(500, 'Could not check project access');
    }
    const projectIds = [...new Set(((links.data ?? []) as { project_id: string }[]).map((l) => l.project_id))];
    const memberships = await readExternalMemberships(admin, userId, org, projectIds);
    if (memberships.length === 0) return NOT_FOUND();
    return { ok: true, userId, admin, orgId: org, memberships };
  } catch (err) {
    log.error('external track access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check project access');
  }
}

/**
 * Is the caller an external member with SOME live membership in this org
 * (optionally one that grants `uploadable`)? For the upload plumbing routes
 * (part / abort / status), which name a session rather than a project: the
 * session itself is then bound to the org and to its starter.
 */
export async function requireExternalInOrg(
  orgId: string,
  mayUpload?: (memberships: readonly ExternalMembership[]) => boolean,
): Promise<ExternalAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(orgId)) return NOT_FOUND();
  const admin = createServiceClient();
  try {
    const memberships = await readExternalMemberships(admin, userId, orgId);
    if (memberships.length === 0 || (mayUpload && !mayUpload(memberships))) return FORBIDDEN();
    return { ok: true, userId, admin, orgId, memberships };
  } catch (err) {
    log.error('external org access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check project access');
  }
}

/**
 * `userId`'s live membership of ONE project, or null (not a member, expired,
 * the org is gone, or the read fails). For `/api/org/join`, which asks about
 * an invitee who is not yet anyone — the external twin of `liveMembership`.
 */
export async function liveProjectMembership(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<ExternalMembership | null> {
  if (!isUUID(orgId) || !isUUID(projectId) || !isUUID(userId)) return null;
  try {
    const all = await readExternalMemberships(admin, userId, orgId, [projectId]);
    return all[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The gate of the upload SESSION routes (part / abort / status): an org
 * member who still holds `catalog.write`, else an external member with an
 * upload-capable membership (`upload_versions`) in this org. Either way
 * `orgSessionAuthorizer` (the upload routes' ./access) then binds the
 * session to this org's key and to the caller. A viewer or commenter, and a
 * stranger, get the org member's refusal (403).
 */
export async function requireUploadActor(orgId: string): Promise<(OrgAccessOk | ExternalAccessOk) | OwnershipFail> {
  const member = await requireOrgCapability(orgId, 'catalog.write');
  if (member.ok) return member;
  if (member.res.status === 401) return member;
  const ext = await requireExternalInOrg(orgId, (ms) => externalMayAny(ms, 'upload_versions'));
  return ext.ok ? ext : member;
}

export type ProjectActor =
  | { ok: true; kind: 'org'; access: OrgAccessOk & { object: OrgObject } }
  | { ok: true; kind: 'external'; access: ExternalAccessOk };
export type ProjectActorResult = ProjectActor | OwnershipFail;

/**
 * A route that serves org members AND external members of a project. An org
 * member who passes requireObjectAccess (membership, capability, artist
 * scope) is an `org` actor, exactly as before. Anyone else who is a live
 * external member of the project is an `external` one. If neither, the
 * answer is the ORG failure unchanged (404 for a stranger, 403 for a member
 * lacking the capability), so adding the external path moves no existing
 * status.
 */
export async function requireProjectActor(opts: { projectId: string; orgId?: string; cap: Capability }): Promise<ProjectActorResult> {
  const asMember = await requireObjectAccess({ table: 'projects', id: opts.projectId, cap: opts.cap, orgId: opts.orgId });
  if (asMember.ok) return { ok: true, kind: 'org', access: asMember };
  if (asMember.res.status === 401) return asMember;
  const external = await requireExternalProject({ projectId: opts.projectId, orgId: opts.orgId });
  return external.ok ? { ok: true, kind: 'external', access: external } : asMember;
}

/** requireProjectActor for a track: org access first, else a live external membership of a project it sits in. */
export async function requireTrackActor(opts: { trackId: string; orgId?: string; cap: Capability }): Promise<ProjectActorResult> {
  const asMember = await requireObjectAccess({ table: 'tracks', id: opts.trackId, cap: opts.cap, orgId: opts.orgId });
  if (asMember.ok) return { ok: true, kind: 'org', access: asMember };
  if (asMember.res.status === 401) return asMember;
  const external = await requireExternalTrack({ trackId: opts.trackId, orgId: opts.orgId });
  return external.ok ? { ok: true, kind: 'external', access: external } : asMember;
}

/**
 * The `project_members` rows of ONE project of the authorised org, for the
 * members panel: the org from the context, the project from the (already
 * authorised) object. Like `memberRowQuery` this is the only place a route
 * reaches a row by `user_id` — a member's identity, never the tenant — and
 * it needs `share.external` on the context (asking without throws, a
 * programming error the route's try/catch turns into a 500, never a read).
 * Writes are the audit functions (`projectMemberUpdate` / `projectMemberRemove`
 * in lib/labelos/audit-rpc), not table writes.
 */
export function projectMemberRows(admin: AdminClient, ctx: Pick<OrgAccessOk, 'orgId' | 'capabilities'>, projectId: string) {
  if (!ctx.capabilities.has('share.external')) throw new Error('projectMemberRows: share.external is required');
  if (!isUUID(projectId)) throw new Error('projectMemberRows: projectId is not a uuid');
  const all = (columns: string) => admin.from('project_members').select(columns).eq('org_id', ctx.orgId).eq('project_id', projectId);
  return {
    list: (columns = '*') => all(columns).order('created_at', { ascending: true }),
    one: (userId: string, columns = '*') => {
      if (!isUUID(userId)) throw new Error('projectMemberRows: userId is not a uuid');
      return all(columns).eq('user_id', userId);
    },
  };
}

// ── "Shared with me" ────────────────────────────────────────────────────

type SharedRow = ProjectMemberRow & {
  org_id: string;
  projects: { name: string | null } | { name: string | null }[] | null;
  organizations: { name: string; deleted_at: string | null } | { name: string; deleted_at: string | null }[] | null;
};

/**
 * The projects shared with the caller: their live external memberships, for
 * the org switcher and `/shared`. Identity, not tenancy — the caller's own
 * rows, like `myOrganizations`. An expired membership, a soft-deleted org or
 * an unknown role is left out, the same rows `readExternalMemberships` refuses.
 */
export async function myExternalProjects(): Promise<
  { ok: true; userId: string; projects: (SharedProjectRef & { orgId: string })[] } | OwnershipFail
> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  const admin = createServiceClient();
  try {
    const { data, error } = await admin
      .from('project_members')
      .select('org_id, project_id, role, allow_downloads, expires_at, projects!inner(name), organizations!inner(name, deleted_at)')
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    const projects: (SharedProjectRef & { orgId: string })[] = [];
    for (const row of (data ?? []) as unknown as SharedRow[]) {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      const membership = toMembership(row);
      if (!org || org.deleted_at || !project || !membership) continue;
      projects.push({
        id: row.project_id,
        orgId: row.org_id,
        name: project.name ?? 'Untitled project',
        orgName: org.name,
        role: membership.role,
        href: sharedProjectHref(row.project_id),
      });
    }
    return { ok: true, userId, projects: sortSharedProjects(projects) };
  } catch (err) {
    log.error('shared project list failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not list shared projects');
  }
}


// ── Artist ↔ label connection (LABEL-41) ────────────────────────────────

/**
 * A LABEL member admitted to music of a connected ARTIST org. `orgId` and the
 * capabilities are the LABEL's (the route's org, the member's own); `sourceOrgId`
 * is the artist org whose rows are read. Read access only: callers that write
 * anything write to the label org (`orgId`) and never to `sourceOrgId`.
 */
export type ConnectedAccessOk = OrgAccessOk & { connection: ConnectionRow; sourceOrgId: string };
export type ConnectedAccessResult = ConnectedAccessOk | OwnershipFail;

async function activeConnection(admin: AdminClient, labelOrgId: string, artistOrgId: string): Promise<{ row: ConnectionRow | null; error: boolean }> {
  const { data, error } = await admin
    .from('org_connections')
    .select(CONNECTION_COLUMNS)
    .eq('label_org_id', labelOrgId)
    .eq('artist_org_id', artistOrgId)
    .eq('status', 'active')
    .maybeSingle();
  // Migration 154 not applied: there is no connection, which reads as 404.
  if (error) return isMissingConnections(error) ? { row: null, error: false } : { row: null, error: true };
  return { row: (data as ConnectionRow | null) ?? null, error: false };
}

/** The shared project ids of a connection (only read when share_mode is `selected`). */
async function sharedProjects(admin: AdminClient, conn: ConnectionRow): Promise<Set<string> | null> {
  if (conn.share_mode === 'all') return new Set();
  const { data, error } = await admin.from('connection_projects').select('project_id').eq('connection_id', conn.id);
  if (error) return null;
  return toSharedSet(((data ?? []) as { project_id: string }[]).map((r) => r.project_id));
}

/** Is the artist org live and of kind artist? */
async function liveArtistOrg(admin: AdminClient, orgId: string): Promise<boolean | null> {
  const { data, error } = await admin.from('organizations').select('id, kind').eq('id', orgId).is('deleted_at', null).maybeSingle();
  if (error) return null;
  return (data as { kind?: string } | null)?.kind === 'artist';
}

/**
 * The rule shared by the helpers below. `labelOrgId` is the route's org; the
 * rows read belong to `sourceOrgId`; `projectIds` are the projects the object
 * sits in (a project: itself). Null = refuse (404); a thrown Error = 500.
 */
async function connectedContext(
  userId: string,
  labelOrgId: string,
  sourceOrgId: string,
  projectIds: readonly string[],
  cap: typeof CONNECTED_CAPABILITY,
): Promise<ConnectedAccessResult> {
  const access = await memberContext(userId, labelOrgId, NOT_FOUND);
  if (!access.ok) return access;
  if (access.orgKind !== 'label' || labelOrgId.toLowerCase() === sourceOrgId.toLowerCase()) return NOT_FOUND();
  const { admin } = access;
  const found = await activeConnection(admin, labelOrgId, sourceOrgId);
  if (found.error) {
    log.error('connection read failed', { labelOrgId });
    return fail(500, 'Could not check organization access');
  }
  const conn = found.row;
  if (!conn) return NOT_FOUND();
  const live = await liveArtistOrg(admin, sourceOrgId);
  if (live === null) return fail(500, 'Could not check organization access');
  if (!live) return NOT_FOUND();
  const shared = await sharedProjects(admin, conn);
  if (!shared) return fail(500, 'Could not check organization access');
  // Only projects of the ARTIST org count; the caller names them by id.
  let inSource: string[] = [];
  if (projectIds.length > 0) {
    const { data, error } = await admin.from('projects').select('id').in('id', [...projectIds]).eq('org_id', sourceOrgId);
    if (error) return fail(500, 'Could not check organization access');
    inSource = ((data ?? []) as { id: string }[]).map((p) => p.id);
  }
  if (!connectionReachesAnyProject(conn, shared, inSource)) return NOT_FOUND();
  // The member's own artist scope, on the roster contact that stands for this artist.
  if (!labelScopeReaches(access.artistScope, conn)) return NOT_FOUND();
  if (!access.capabilities.has(cap)) return NOT_FOUND();
  return { ...access, connection: conn, sourceOrgId };
}

/**
 * A recording of a connected artist org, reached by a member of the route's
 * LABEL org. 401 without a session; 404 for everything else (a producer
 * track, another org's, a recording outside the shared projects, an ended or
 * pending connection, a member out of scope or without `catalog.read`).
 */
export async function requireConnectedTrack(opts: { trackId: string; orgId: string; cap: typeof CONNECTED_CAPABILITY }): Promise<ConnectedAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(opts.trackId) || !isUUID(opts.orgId)) return NOT_FOUND();
  const admin = createServiceClient();
  try {
    const { data, error } = await admin.from('tracks').select('org_id').eq('id', opts.trackId).maybeSingle();
    if (error) {
      log.error('track read failed', { trackId: opts.trackId, error: error.message });
      return fail(500, 'Could not check organization access');
    }
    const source = (data as { org_id?: unknown } | null)?.org_id;
    if (typeof source !== 'string' || !isUUID(source)) return NOT_FOUND();
    const links = await admin.from('project_tracks').select('project_id').eq('track_id', opts.trackId);
    if (links.error) return fail(500, 'Could not check organization access');
    const projectIds = [...new Set(((links.data ?? []) as { project_id: string }[]).map((l) => l.project_id))];
    return await connectedContext(userId, opts.orgId, source, projectIds, opts.cap);
  } catch (err) {
    log.error('connected track access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
}

/** A project of a connected artist org, reached by a member of the route's LABEL org. Same refusals as the track. */
export async function requireConnectedProject(opts: { projectId: string; orgId: string; cap: typeof CONNECTED_CAPABILITY }): Promise<ConnectedAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(opts.projectId) || !isUUID(opts.orgId)) return NOT_FOUND();
  const admin = createServiceClient();
  try {
    const { data, error } = await admin.from('projects').select('org_id').eq('id', opts.projectId).maybeSingle();
    if (error) {
      log.error('project read failed', { projectId: opts.projectId, error: error.message });
      return fail(500, 'Could not check organization access');
    }
    const source = (data as { org_id?: unknown } | null)?.org_id;
    if (typeof source !== 'string' || !isUUID(source)) return NOT_FOUND();
    return await connectedContext(userId, opts.orgId, source, [opts.projectId], opts.cap);
  } catch (err) {
    log.error('connected project access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
}

/**
 * The route's LABEL org and ONE connection of it, for the routes that list the
 * shared music (`…/connections/[connectionId]/projects`) or copy from it. The
 * connection must be active, belong to this label, have a live artist org and
 * be within the member's own artist scope. Reaches the connection, not a
 * particular project: the route then lists only what the connection shares.
 */
export async function requireConnectionOfLabel(opts: { orgId: string; connectionId: string; cap: typeof CONNECTED_CAPABILITY }): Promise<ConnectedAccessResult> {
  const userId = await sessionUserId();
  if (!userId) return NOT_AUTHENTICATED();
  if (!isUUID(opts.orgId)) return FORBIDDEN();
  const access = await memberContext(userId, opts.orgId, FORBIDDEN);
  if (!access.ok) return access;
  if (!isUUID(opts.connectionId) || access.orgKind !== 'label') return NOT_FOUND();
  const { admin } = access;
  try {
    const { data, error } = await admin
      .from('org_connections')
      .select(CONNECTION_COLUMNS)
      .eq('id', opts.connectionId)
      .eq('label_org_id', opts.orgId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) return isMissingConnections(error) ? NOT_FOUND() : fail(500, 'Could not check organization access');
    const conn = data as ConnectionRow | null;
    if (!conn) return NOT_FOUND();
    const live = await liveArtistOrg(admin, conn.artist_org_id);
    if (live === null) return fail(500, 'Could not check organization access');
    if (!live) return NOT_FOUND();
    if (!labelScopeReaches(access.artistScope, conn)) return NOT_FOUND();
    if (!access.capabilities.has(opts.cap)) return NOT_FOUND();
    return { ...access, connection: conn, sourceOrgId: conn.artist_org_id };
  } catch (err) {
    log.error('connection access failed', { error: err instanceof Error ? err.message : String(err) });
    return fail(500, 'Could not check organization access');
  }
}

// Re-exported so a route that lists a connection's shared projects asks the one rule.
export { connectionReachesProject };
