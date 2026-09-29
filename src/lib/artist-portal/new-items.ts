/**
 * What is NEW in an artist's portal, and what the artist has not been TOLD
 * about yet.
 *
 * Two watermarks, two questions:
 *   - `previous_viewed_at` (artist_portals) — "new since your last visit",
 *     the NEW marker the artist sees. A visit moves `last_viewed_at` into it
 *     before stamping the new visit, so NEW survives the page load that is
 *     looking at it.
 *   - `last_notified_at` (project_contacts) — "new since you last pressed
 *     Notify", the count on the producer's "Notify · N new" button.
 *
 * A track becomes visible in the portal at the LATER of its
 * `project_tracks.added_at` and the moment its project went into the portal —
 * a beat added to a project in March is not "new" to an artist whose portal
 * got that project yesterday … except that the project itself is.
 */

export interface PortalProjectRow {
  projectId: string;
  /** When the project was linked to this contact (project_contacts.created_at). */
  linkedAt: string;
  lastNotifiedAt: string | null;
}

export interface PortalTrackRow {
  projectId: string;
  trackId: string;
  addedAt: string;
}

/** When a track in a portal project became visible to the artist. */
export function availableAt(track: PortalTrackRow, project: PortalProjectRow | undefined): string {
  if (!project) return track.addedAt;
  return track.addedAt > project.linkedAt ? track.addedAt : project.linkedAt;
}

/** NEW marker: visible after the artist's previous visit. No previous visit = everything is new. */
export function isNewSince(visibleAt: string, watermark: string | null | undefined): boolean {
  if (!watermark) return true;
  return visibleAt > watermark;
}

/** A project file in the portal (project_assets with in_portal). */
export interface PortalFileRow {
  projectId: string;
  fileId: string;
  /** project_assets.portal_at, or created_at when it was uploaded straight into the portal. */
  portalAt: string;
}

export interface NotifyCount {
  /** Projects in the portal the artist was never told about. */
  newProjects: string[];
  /** Tracks added to portal projects since that project's last notify. */
  newTracks: Array<{ projectId: string; trackId: string }>;
  /** Project files put in the portal since that project's last notify. */
  newFiles: Array<{ projectId: string; fileId: string }>;
  total: number;
}

/**
 * Items the artist has not been notified about, per project row's
 * `last_notified_at`. A project never notified counts once as a new project
 * and its tracks and files are not counted again on top — "New EP · 12
 * beats" is one piece of news, not thirteen.
 */
export function countUnnotified(
  projects: readonly PortalProjectRow[],
  tracks: readonly PortalTrackRow[],
  files: readonly PortalFileRow[] = [],
): NotifyCount {
  const byId = new Map(projects.map((p) => [p.projectId, p]));
  const newProjects = projects.filter((p) => !p.lastNotifiedAt).map((p) => p.projectId);
  const seen = new Set<string>();
  const newTracks: Array<{ projectId: string; trackId: string }> = [];
  for (const t of tracks) {
    const p = byId.get(t.projectId);
    if (!p || !p.lastNotifiedAt) continue;
    const key = `${t.projectId}:${t.trackId}`;
    if (seen.has(key)) continue;
    if (availableAt(t, p) > p.lastNotifiedAt) {
      seen.add(key);
      newTracks.push({ projectId: t.projectId, trackId: t.trackId });
    }
  }
  const newFiles: Array<{ projectId: string; fileId: string }> = [];
  for (const f of files) {
    const p = byId.get(f.projectId);
    if (!p || !p.lastNotifiedAt) continue;
    const visible = f.portalAt > p.linkedAt ? f.portalAt : p.linkedAt;
    if (visible > p.lastNotifiedAt && !newFiles.some((x) => x.fileId === f.fileId)) {
      newFiles.push({ projectId: f.projectId, fileId: f.fileId });
    }
  }
  return { newProjects, newTracks, newFiles, total: newProjects.length + newTracks.length + newFiles.length };
}

/**
 * The watermarks a portal visit writes. `last_viewed_at` becomes the new
 * `previous_viewed_at` only when the last visit is older than `sessionGapMs`:
 * reloading the page, or clicking between projects, must not wipe the NEW
 * markers the artist is in the middle of reading.
 */
export function nextVisitWatermarks(
  portal: { last_viewed_at: string | null; previous_viewed_at: string | null },
  now: string,
  sessionGapMs = 30 * 60 * 1000,
): { last_viewed_at: string; previous_viewed_at: string | null; isNewVisit: boolean } {
  const last = portal.last_viewed_at;
  const isNewVisit = !last || Date.parse(now) - Date.parse(last) >= sessionGapMs;
  return {
    last_viewed_at: now,
    previous_viewed_at: isNewVisit ? last : portal.previous_viewed_at,
    isNewVisit,
  };
}
