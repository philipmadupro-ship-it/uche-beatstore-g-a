/**
 * What an artist portal covers: the projects linked to its contact with
 * `project_contacts.in_portal`, and the tracks in them.
 *
 * Every portal route answers membership through here, so "is this project /
 * track in this portal" has one definition. A project that is not in the
 * portal is answered as NOT FOUND by the routes, never forbidden, so its
 * existence is not revealed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface PortalRef {
  user_id: string;
  contact_id: string;
}

export interface PortalProjectLink {
  project_id: string;
  created_at: string;
  last_notified_at: string | null;
  allow_downloads: boolean;
  can_comment: boolean;
  role: string;
}

/**
 * project_contacts rows that put a project in this portal (owner-filtered).
 * An archived project leaves the portal without unlinking it, so archiving is
 * reversible and the artist's history stays attached.
 */
export async function portalProjectLinks(admin: Admin, portal: PortalRef): Promise<PortalProjectLink[]> {
  const { data, error } = await admin
    .from('project_contacts')
    .select('project_id, created_at, last_notified_at, allow_downloads, can_comment, role')
    .eq('contact_id', portal.contact_id)
    .eq('user_id', portal.user_id)
    .eq('in_portal', true);
  if (error) throw error;
  const links = (data ?? []) as PortalProjectLink[];
  if (links.length === 0) return links;
  const { data: live, error: pErr } = await admin
    .from('projects')
    .select('id, status')
    .in('id', links.map((l) => l.project_id))
    .eq('user_id', portal.user_id);
  if (pErr) throw pErr;
  const liveIds = new Set(((live ?? []) as Array<{ id: string; status: string | null }>)
    .filter((p) => p.status !== 'archived')
    .map((p) => p.id));
  return links.filter((l) => liveIds.has(l.project_id));
}

/** The portal projects that contain `trackId` (empty = not in this portal). */
export async function portalProjectsWithTrack(admin: Admin, portal: PortalRef, trackId: string): Promise<PortalProjectLink[]> {
  const links = await portalProjectLinks(admin, portal);
  if (links.length === 0) return [];
  const { data, error } = await admin
    .from('project_tracks')
    .select('project_id')
    .eq('track_id', trackId)
    .in('project_id', links.map((l) => l.project_id));
  if (error) throw error;
  const hit = new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id));
  return links.filter((l) => hit.has(l.project_id));
}
