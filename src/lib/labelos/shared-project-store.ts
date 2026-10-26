/**
 * Loads what an external project member sees (LABEL-21): the project, its
 * tracks in order, the artist NAMES, who uploaded what. The caller has
 * already run `requireExternalProject`, so the org and the live membership
 * are known; every read here is keyed by that project and org, and nothing
 * outside them is ever asked for. Shaped by ./shared-project.
 */
import type { ExternalAccessOk } from '@/lib/auth/org-access';
import { toSharedProjectView, type SharedProjectView, type SharedTrackRow } from './shared-project';

type Row = Record<string, unknown>;

function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

export async function loadSharedProject(access: ExternalAccessOk, projectId: string): Promise<SharedProjectView | null> {
  const { admin, orgId } = access;
  const membership = access.memberships.find((m) => m.projectId === projectId);
  if (!membership) return null;

  const projects = ok<{ id: string; name: string | null; inbox_for_contact_id: string | null }>(
    await admin.from('projects').select('id, name, inbox_for_contact_id').eq('id', projectId).eq('org_id', orgId),
    'project read',
  );
  const project = projects[0];
  if (!project) return null;

  const [orgs, placements, linked] = await Promise.all([
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    admin.from('project_tracks').select('track_id, position').eq('project_id', projectId).order('position', { ascending: true }),
    admin.from('project_contacts').select('contact_id').eq('project_id', projectId),
  ]);
  if (orgs.error) throw new Error(`organization read failed: ${orgs.error.message}`);
  const orgName = (orgs.data as { name?: string } | null)?.name ?? null;

  const order = ok<{ track_id: string; position: number | null }>(placements, 'project track read');
  const trackIds = [...new Set(order.map((p) => p.track_id))];
  const tracks = trackIds.length
    ? ok<SharedTrackRow & Row>(
        await admin
          .from('tracks')
          .select('id, title, type, song_stage, bpm, key, scale, duration_seconds, created_by')
          .in('id', trackIds)
          .eq('org_id', orgId),
        'track read',
      )
    : [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ordered = trackIds.map((id) => byId.get(id)).filter((t): t is SharedTrackRow & Row => !!t);

  // Artist NAMES only (07 §1): the project's inbox artist and linked contacts of this org.
  const contactIds = [
    ...new Set([
      ...(project.inbox_for_contact_id ? [project.inbox_for_contact_id] : []),
      ...ok<{ contact_id: string | null }>(linked, 'project contact read').map((c) => c.contact_id).filter((c): c is string => !!c),
    ]),
  ];
  const artistNames = contactIds.length
    ? ok<{ name: string | null }>(await admin.from('contacts').select('name').in('id', contactIds).eq('org_id', orgId), 'artist read')
        .map((c) => c.name ?? '')
        .filter(Boolean)
    : [];

  // Credits (D3): the uploader's display name, from their profile.
  const uploaderIds = [...new Set(ordered.map((t) => t.created_by).filter((id): id is string => typeof id === 'string'))];
  const names = new Map<string, string>();
  if (uploaderIds.length) {
    for (const table of ['creator_profiles', 'user_profiles'] as const) {
      const res = await admin.from(table).select('user_id, display_name').in('user_id', uploaderIds);
      if (res.error) continue;
      for (const r of (res.data ?? []) as { user_id: string; display_name: unknown }[]) {
        if (typeof r.display_name === 'string' && r.display_name.trim()) names.set(r.user_id, r.display_name.trim());
      }
    }
  }

  return toSharedProjectView({
    project: { id: project.id, name: project.name, orgId, orgName },
    artistNames,
    membership,
    tracks: ordered,
    names,
  });
}
