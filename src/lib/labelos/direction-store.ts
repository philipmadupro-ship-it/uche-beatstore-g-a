/**
 * The reads and writes behind `/api/org/[orgId]/artists/[contactId]/direction`
 * and `…/references*` (LABEL-26). The rules are `direction.ts`; this file only
 * touches the database. Service-role client, org filter on every query:
 * authorisation is the route's (`requireObjectAccess` on the contact).
 *
 * A reference's pointer is resolved for THIS member: a track they may not read
 * (D4's row rule, or outside their artist scope) and a file they may not open
 * (org-assets' capability rule, or outside their scope) resolve to nothing, so
 * the reference is counted as restricted instead of leaking a title.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { orgProjectIdsInScope, type OrgAccessOk } from '@/lib/auth/org-access';
import { canReadOrgAsset, ORG_ASSET_COLUMNS, toOrgAssetView, type OrgAssetRow } from './org-assets';
import { memberSeesTrackRow } from './org-workspace';
import { artistProjects, orgTrackFacts } from './org-workspace-store';
import {
  normalizeDirection,
  referenceFileAllowed,
  type ArtistDirection,
  type ReferenceKind,
  type ReferenceRow,
  type ReferenceVisibility,
  type ResolvedPointer,
} from './direction';

type Access = Pick<OrgAccessOk, 'orgId' | 'userId' | 'artistScope' | 'capabilities'>;

function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

export const REFERENCE_COLUMNS = 'id, kind, title, note, url, track_id, asset_id, visibility, position, created_at, updated_at';

// ── Direction ───────────────────────────────────────────────────────────

export async function readDirection(admin: AdminClient, org: string, contactId: string): Promise<{ direction: ArtistDirection; updatedAt: string | null }> {
  const res = await admin.from('artist_direction').select('direction, updated_at').eq('org_id', org).eq('contact_id', contactId).maybeSingle();
  const row = ok<{ direction: unknown; updated_at: string } | null>(res, 'direction read');
  return row ? { direction: normalizeDirection(row.direction), updatedAt: row.updated_at } : { direction: {}, updatedAt: null };
}

export async function writeDirection(admin: AdminClient, o: { orgId: string; contactId: string; userId: string; direction: ArtistDirection }): Promise<string> {
  const res = await admin
    .from('artist_direction')
    .upsert(
      { org_id: o.orgId, contact_id: o.contactId, direction: normalizeDirection(o.direction), updated_by: o.userId, updated_at: new Date().toISOString() },
      { onConflict: 'contact_id' },
    )
    .select('updated_at')
    .single();
  return ok<{ updated_at: string }>(res, 'direction write').updated_at;
}

// ── References ──────────────────────────────────────────────────────────

export async function listReferenceRows(admin: AdminClient, org: string, contactId: string): Promise<ReferenceRow[]> {
  const res = await admin.from('artist_references').select(REFERENCE_COLUMNS).eq('org_id', org).eq('contact_id', contactId).order('position', { ascending: true }).order('created_at', { ascending: true });
  return ok<ReferenceRow[] | null>(res, 'reference list') ?? [];
}

export async function readReferenceRow(admin: AdminClient, org: string, contactId: string, id: string): Promise<ReferenceRow | null> {
  const res = await admin.from('artist_references').select(REFERENCE_COLUMNS).eq('org_id', org).eq('contact_id', contactId).eq('id', id).maybeSingle();
  return ok<ReferenceRow | null>(res, 'reference read');
}

export type NewReference = {
  orgId: string;
  contactId: string;
  userId: string;
  kind: ReferenceKind;
  title: string;
  note: string | null;
  url: string | null;
  trackId: string | null;
  assetId: string | null;
  visibility: ReferenceVisibility;
  position: number;
};

export async function insertReference(admin: AdminClient, r: NewReference): Promise<ReferenceRow> {
  const res = await admin
    .from('artist_references')
    .insert({
      org_id: r.orgId,
      contact_id: r.contactId,
      kind: r.kind,
      title: r.title,
      note: r.note,
      url: r.url,
      track_id: r.trackId,
      asset_id: r.assetId,
      visibility: r.visibility,
      position: r.position,
      created_by: r.userId,
    })
    .select(REFERENCE_COLUMNS)
    .single();
  return ok<ReferenceRow>(res, 'reference insert');
}

export type ReferenceColumns = Partial<{ title: string; note: string | null; url: string | null; visibility: ReferenceVisibility; position: number }>;

export async function updateReference(admin: AdminClient, org: string, contactId: string, id: string, columns: ReferenceColumns): Promise<ReferenceRow | null> {
  const res = await admin
    .from('artist_references')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('org_id', org)
    .eq('contact_id', contactId)
    .eq('id', id)
    .select(REFERENCE_COLUMNS)
    .maybeSingle();
  return ok<ReferenceRow | null>(res, 'reference update');
}

export async function deleteReference(admin: AdminClient, org: string, contactId: string, id: string): Promise<boolean> {
  const res = await admin.from('artist_references').delete().eq('org_id', org).eq('contact_id', contactId).eq('id', id).select('id');
  return (ok<{ id: string }[] | null>(res, 'reference delete') ?? []).length > 0;
}

// ── What the member may open ────────────────────────────────────────────

/** The org's track ids the member's artist scope reaches; null = all of them (a whole-org member). */
async function scopedTrackIds(admin: AdminClient, access: Access): Promise<Set<string> | null> {
  const projects = await orgProjectIdsInScope(admin, access as OrgAccessOk);
  if (projects === null) return null;
  if (projects.length === 0) return new Set();
  const res = await admin.from('project_tracks').select('track_id').in('project_id', projects);
  return new Set((ok<{ track_id: string }[] | null>(res, 'scoped tracks') ?? []).map((r) => r.track_id));
}

/** Tracks of the org the member may read as a row (D4) inside their scope, with their titles. */
export async function readableTracks(admin: AdminClient, access: Access, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = [...new Set(ids)];
  if (want.length === 0) return out;
  const [facts, scope, titles] = await Promise.all([
    orgTrackFacts(admin, access.orgId, want),
    scopedTrackIds(admin, access),
    admin.from('tracks').select('id, title').eq('org_id', access.orgId).in('id', want),
  ]);
  for (const t of ok<{ id: string; title: string | null }[] | null>(titles, 'track titles') ?? []) {
    const f = facts.get(t.id);
    if (!f || !memberSeesTrackRow(access.capabilities, f)) continue;
    if (scope !== null && !scope.has(t.id)) continue;
    out.set(t.id, t.title?.trim() || 'Untitled');
  }
  return out;
}

/** Visual files of the org the member may open, inside their scope, keyed by id. */
export async function readableFiles(admin: AdminClient, access: Access, ids: readonly string[]): Promise<Map<string, OrgAssetRow>> {
  const out = new Map<string, OrgAssetRow>();
  const want = [...new Set(ids)];
  if (want.length === 0) return out;
  const [res, projects] = await Promise.all([
    admin.from('project_assets').select(ORG_ASSET_COLUMNS).eq('org_id', access.orgId).in('id', want),
    orgProjectIdsInScope(admin, access as OrgAccessOk),
  ]);
  const scope = projects === null ? null : new Set(projects);
  for (const a of ok<OrgAssetRow[] | null>(res, 'file read') ?? []) {
    if (!canReadOrgAsset(access.capabilities, a) || !referenceFileAllowed(a)) continue;
    if (scope !== null && !scope.has(a.project_id)) continue;
    out.set(a.id, a);
  }
  return out;
}

/** The pointer of every reference, resolved for this member (one query per kind). */
export async function resolvePointers(admin: AdminClient, access: Access, rows: readonly ReferenceRow[]): Promise<(row: ReferenceRow) => ResolvedPointer> {
  const [tracks, files] = await Promise.all([
    readableTracks(admin, access, rows.flatMap((r) => (r.track_id ? [r.track_id] : []))),
    readableFiles(admin, access, rows.flatMap((r) => (r.asset_id ? [r.asset_id] : []))),
  ]);
  return (row) => {
    if (row.kind === 'track' && row.track_id) {
      const title = tracks.get(row.track_id);
      return title === undefined ? null : { kind: 'track', title };
    }
    if (row.kind === 'file' && row.asset_id) {
      const a = files.get(row.asset_id);
      return a ? { kind: 'file', label: a.label, fileKind: a.kind, mime: a.mime, downloadUrl: toOrgAssetView(a).downloadUrl } : null;
    }
    return null;
  };
}

// ── Pickers ─────────────────────────────────────────────────────────────

export type FileChoice = { id: string; label: string; kind: string; project: string };

/** Visual files on this artist's projects the member may open, for the file picker (newest first, capped). */
export async function fileChoices(admin: AdminClient, access: Access, contactId: string): Promise<FileChoice[]> {
  const projects = await artistProjects(admin, access.orgId, contactId);
  if (projects.length === 0) return [];
  const res = await admin
    .from('project_assets')
    .select(ORG_ASSET_COLUMNS)
    .eq('org_id', access.orgId)
    .in('project_id', projects.map((p) => p.id))
    .order('created_at', { ascending: false })
    .limit(200);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return (ok<OrgAssetRow[] | null>(res, 'file choices') ?? [])
    .filter((a) => canReadOrgAsset(access.capabilities, a) && referenceFileAllowed(a))
    .slice(0, 50)
    .map((a) => ({ id: a.id, label: a.label, kind: a.kind, project: names.get(a.project_id) ?? '' }));
}

export type TrackChoice = { id: string; title: string; type: string | null };

/** Org tracks the member may read, matching `q` in the title, for the track picker. */
export async function trackChoices(admin: AdminClient, access: Access, q: string): Promise<TrackChoice[]> {
  const term = q.trim().replace(/[%_,()\\]/g, ' ').trim().slice(0, 80);
  let query = admin.from('tracks').select('id, title, type').eq('org_id', access.orgId).order('created_at', { ascending: false }).limit(60);
  if (term) query = query.ilike('title', `%${term}%`);
  const rows = ok<{ id: string; title: string | null; type: string | null }[] | null>(await query, 'track choices') ?? [];
  const readable = await readableTracks(admin, access, rows.map((r) => r.id));
  return rows
    .filter((r) => readable.has(r.id))
    .slice(0, 20)
    .map((r) => ({ id: r.id, title: readable.get(r.id) ?? 'Untitled', type: r.type }));
}
