/**
 * What a LABEL member sees of the music a connected ARTIST org shared
 * (LABEL-41): the shared projects and, in each, the recordings THIS member may
 * hear. Read-only, built field by field — no stored audio reference, no
 * artist or member ids, no stages, no files, no comments, no activity.
 *
 * D4 runs with the label member's OWN capabilities against the artist org's
 * link rows (orgTrackFacts reads them with the artist org as the org): a track
 * is listed only if the member could stream it in full, so marketing, who holds
 * `audio.finished` only, sees finished recordings and not the demos next to
 * them. Nothing says how many were left out.
 */
import type { ConnectedAccessOk } from '@/lib/auth/org-access';
import { orgAudioAllowed } from './org-audio';
import { isCopyableType, type ConnectedMusic } from './connections';
import { orgTrackFacts } from './org-workspace-store';
import { sharedProjects } from './connections-store';

type Row = Record<string, unknown>;

function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/** Pure: which tracks a member may list. A track with no facts (not an org track of the artist org) is out. */
export function listableTrackIds(
  trackIds: readonly string[],
  facts: ReadonlyMap<string, { requiredAudio: Parameters<typeof orgAudioAllowed>[1] }>,
  held: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const id of trackIds) {
    const f = facts.get(id);
    if (f && orgAudioAllowed(held, f.requiredAudio)) out.add(id);
  }
  return out;
}

export async function loadConnectedMusic(access: ConnectedAccessOk): Promise<ConnectedMusic> {
  const { admin, connection: conn, sourceOrgId } = access;
  const projects = await sharedProjects(admin, conn);
  const projectIds = projects.map((p) => p.id);
  const placements = projectIds.length
    ? ok<{ project_id: string; track_id: string; position: number | null }>(
        await admin.from('project_tracks').select('project_id, track_id, position').in('project_id', projectIds).order('position', { ascending: true }),
        'project track read',
      )
    : [];
  const trackIds = [...new Set(placements.map((p) => p.track_id))];
  const tracks = trackIds.length
    ? ok<Row & { id: string }>(
        await admin
          .from('tracks')
          .select('id, title, type, bpm, key, scale, duration_seconds')
          .in('id', trackIds)
          .eq('org_id', sourceOrgId),
        'track read',
      )
    : [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const facts = await orgTrackFacts(admin, sourceOrgId, tracks.map((t) => t.id));
  const listable = listableTrackIds(tracks.map((t) => t.id), facts, access.capabilities);
  const mayCopy = conn.allow_copies && access.capabilities.has('catalog.write');

  return {
    connection: { id: conn.id, allowCopies: conn.allow_copies, shareMode: conn.share_mode },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      isInbox: !!p.inbox_for_contact_id,
      recordings: placements
        .filter((pl) => pl.project_id === p.id && listable.has(pl.track_id) && byId.has(pl.track_id))
        .map((pl) => {
          const t = byId.get(pl.track_id)!;
          return {
            id: t.id,
            title: typeof t.title === 'string' && t.title ? t.title : 'Untitled',
            type: typeof t.type === 'string' ? t.type : null,
            bpm: typeof t.bpm === 'number' ? t.bpm : null,
            key: typeof t.key === 'string' ? t.key : null,
            scale: typeof t.scale === 'string' ? t.scale : null,
            durationSeconds: typeof t.duration_seconds === 'number' ? t.duration_seconds : null,
            canCopy: mayCopy && isCopyableType(typeof t.type === 'string' ? t.type : null),
          };
        }),
    })),
  };
}
