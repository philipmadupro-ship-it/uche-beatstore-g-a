/**
 * Reads for the artist ↔ label connection routes (LABEL-41). Every function
 * is keyed by the org the route authorised and never trusts an id from the
 * request alone: a connection is only returned to a party of it.
 * Writes are the audit functions (lib/labelos/audit-rpc), not table writes.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { CONNECTION_COLUMNS, sideOf, type ConnectionRow } from './connections';

function rows<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T[] {
  if (res.error) throw Object.assign(new Error(`${what} failed: ${res.error.message}`), { code: res.error.code });
  return (res.data ?? []) as T[];
}

export type OrgIdentity = { id: string; name: string; slug: string; kind: string };

/** The public identity (name, slug, kind) of some orgs; a deleted org is left out. */
export async function orgIdentities(admin: AdminClient, ids: readonly string[]): Promise<Map<string, OrgIdentity>> {
  const out = new Map<string, OrgIdentity>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const found = rows<OrgIdentity>(
    await admin.from('organizations').select('id, name, slug, kind').in('id', unique).is('deleted_at', null),
    'organization read',
  );
  for (const o of found) out.set(o.id, o);
  return out;
}

/** The open (requested or active) connections the org is a party of, newest first. */
export async function listOpenConnections(admin: AdminClient, orgId: string, kind: 'label' | 'artist'): Promise<ConnectionRow[]> {
  const column = kind === 'label' ? 'label_org_id' : 'artist_org_id';
  return rows<ConnectionRow>(
    await admin
      .from('org_connections')
      .select(CONNECTION_COLUMNS)
      .eq(column, orgId)
      .in('status', ['requested', 'active'])
      .order('created_at', { ascending: false }),
    'connection read',
  );
}

/** One connection, only if `orgId` is a party of it. */
export async function readPartyConnection(admin: AdminClient, orgId: string, connectionId: string): Promise<ConnectionRow | null> {
  const found = rows<ConnectionRow>(
    await admin.from('org_connections').select(CONNECTION_COLUMNS).eq('id', connectionId).limit(1),
    'connection read',
  )[0];
  if (!found || !sideOf(found, orgId)) return null;
  return found;
}

/** connection id → its selected project ids. */
export async function selectedProjectIds(admin: AdminClient, connectionIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (connectionIds.length === 0) return out;
  const found = rows<{ connection_id: string; project_id: string }>(
    await admin.from('connection_projects').select('connection_id, project_id').in('connection_id', [...connectionIds]),
    'connection project read',
  );
  for (const r of found) out.set(r.connection_id, [...(out.get(r.connection_id) ?? []), r.project_id]);
  return out;
}

export type ConnectedProjectRow = { id: string; name: string; cover_url: string | null; status: string | null; inbox_for_contact_id: string | null };

/** The artist org's projects that a connection reaches: all of them, or the selected ones. */
export async function sharedProjects(admin: AdminClient, conn: ConnectionRow): Promise<ConnectedProjectRow[]> {
  const select = 'id, name, cover_url, status, inbox_for_contact_id';
  if (conn.share_mode === 'all') {
    return rows<ConnectedProjectRow>(
      await admin.from('projects').select(select).eq('org_id', conn.artist_org_id).order('created_at', { ascending: false }),
      'project read',
    );
  }
  const ids = (await selectedProjectIds(admin, [conn.id])).get(conn.id) ?? [];
  if (ids.length === 0) return [];
  return rows<ConnectedProjectRow>(
    await admin.from('projects').select(select).in('id', ids).eq('org_id', conn.artist_org_id).order('created_at', { ascending: false }),
    'project read',
  );
}

/** The artist org's own projects, for the sharing picker (names only). */
export async function artistOrgProjectChoices(admin: AdminClient, artistOrgId: string): Promise<{ id: string; name: string }[]> {
  return rows<{ id: string; name: string }>(
    await admin.from('projects').select('id, name').eq('org_id', artistOrgId).order('created_at', { ascending: false }).limit(500),
    'project read',
  );
}

export type ConnectedRosterEntry = { connectionId: string; orgName: string; orgSlug: string };

/**
 * The label's roster contacts that stand for a connected artist org (active
 * connections only), for the "Connected" mark on the roster. Best effort by
 * design: before migration 154 there is no such table and the roster simply
 * shows no marks.
 */
export async function connectedRoster(admin: AdminClient, labelOrgId: string, contactIds: readonly string[]): Promise<Map<string, ConnectedRosterEntry>> {
  const out = new Map<string, ConnectedRosterEntry>();
  if (contactIds.length === 0) return out;
  const res = await admin
    .from('org_connections')
    .select('id, artist_org_id, label_contact_id')
    .eq('label_org_id', labelOrgId)
    .eq('status', 'active')
    .in('label_contact_id', [...contactIds]);
  if (res.error) return out;
  const found = (res.data ?? []) as { id: string; artist_org_id: string; label_contact_id: string }[];
  const identities = await orgIdentities(admin, found.map((c) => c.artist_org_id)).catch(() => new Map<string, OrgIdentity>());
  for (const c of found) {
    const org = identities.get(c.artist_org_id);
    if (org) out.set(c.label_contact_id, { connectionId: c.id, orgName: org.name, orgSlug: org.slug });
  }
  return out;
}
