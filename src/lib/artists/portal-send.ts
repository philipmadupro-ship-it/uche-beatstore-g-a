/**
 * Portal lifecycle and the one email the portal ever sends.
 *
 * Adding material to a portal project never emails anyone. The producer
 * presses "Notify · N new" (or "Share with <artist>", which is the same thing
 * the first time) and this sends ONE digest pointing at the same permanent
 * link, then records it the way every other send is recorded:
 *   - a `beat_sends` row (with the Resend id, so the webhook stamps the open
 *     and click on it, and the nudge queue sees it),
 *   - an `artist_notified` contact_activity row for the timeline,
 *   - `project_contacts.last_notified_at`, which is what the count reads.
 * Every write is owner-filtered: this runs on the service-role client.
 */

import { nanoid } from 'nanoid';
import { Resend } from 'resend';
import { getAppUrl } from '@/lib/env';
import { selectIn } from '@/lib/db/chunked-in';
import { buildPortalDigest } from '@/lib/artist-portal/digest';
import { countUnnotified } from '@/lib/artist-portal/new-items';
import { buildProjectSendRow } from '@/lib/crm/project-send';
import { loadPortalAssets, toPortalFileRows } from '@/lib/artist-portal/files';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Portal tokens are permanent bearer credentials: longer than a 12-char share token. */
export const PORTAL_TOKEN_LENGTH = 24;

export function newPortalToken(): string {
  return nanoid(PORTAL_TOKEN_LENGTH);
}

export function portalUrl(token: string): string {
  return `${getAppUrl()}/artist/${token}`;
}

export interface PortalRecord {
  id: string;
  token: string;
  revoked_at: string | null;
}

/** The contact's portal, created if it has none. A revoked portal is returned as is. */
export async function ensurePortal(admin: Admin, userId: string, contactId: string): Promise<{ portal: PortalRecord; created: boolean }> {
  const { data: existing, error } = await admin
    .from('artist_portals')
    .select('id, token, revoked_at')
    .eq('contact_id', contactId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return { portal: existing as PortalRecord, created: false };

  const { data, error: insertErr } = await admin
    .from('artist_portals')
    .insert({ user_id: userId, contact_id: contactId, token: newPortalToken() })
    .select('id, token, revoked_at')
    .single();
  if (insertErr) {
    // Two tabs pressing Share at once: the unique contact_id lost the race.
    if ((insertErr as { code?: string }).code === '23505') return ensurePortal(admin, userId, contactId);
    throw insertErr;
  }
  return { portal: data as PortalRecord, created: true };
}

export type DigestResult =
  | { ok: true; itemCount: number; beatSendId: string | null; resendId: string | null; recipient: string }
  | { ok: false; status: number; error: string };

interface LinkRow { project_id: string; created_at: string; last_notified_at: string | null }
interface ProjectTrackRow { project_id: string; track_id: string; added_at: string }

/**
 * Send the digest of everything in the portal the artist has not been told
 * about. `force` sends even when the count is zero (the first share of an
 * empty project still deserves an invite).
 */
export async function sendPortalDigest(
  admin: Admin,
  opts: {
    userId: string;
    contact: { id: string; name: string | null; email: string | null };
    message?: string;
    /** Send even with nothing new (a re-share). */
    force?: boolean;
    /** The project being shared: named in a forced digest that has no other news. */
    focusProjectId?: string;
    now?: Date;
  },
): Promise<DigestResult> {
  const { userId, contact } = opts;
  if (!contact.email) return { ok: false, status: 400, error: 'This contact has no email address.' };
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, status: 503, error: 'Email sending is not configured. Set RESEND_API_KEY in your environment.' };
  }

  const { portal } = await ensurePortal(admin, userId, contact.id);
  if (portal.revoked_at) return { ok: false, status: 409, error: 'This portal is revoked. Reissue it before notifying.' };

  const { data: linkData, error: linkErr } = await admin
    .from('project_contacts')
    .select('project_id, created_at, last_notified_at')
    .eq('contact_id', contact.id)
    .eq('user_id', userId)
    .eq('in_portal', true);
  if (linkErr) throw linkErr;
  const allLinks = (linkData ?? []) as LinkRow[];
  // Archived projects are not in the portal (membership.ts): never announce them.
  const liveProjects = allLinks.length
    ? await selectIn<{ id: string; name: string | null; status: string | null }>((ids) => admin.from('projects').select('id, name, status').in('id', ids).eq('user_id', userId), allLinks.map((l) => l.project_id))
    : [];
  const projects = liveProjects.filter((p) => p.status !== 'archived');
  const links = allLinks.filter((l) => projects.some((p) => p.id === l.project_id));
  if (links.length === 0) return { ok: false, status: 409, error: 'Nothing is in this artist’s portal yet. Share a project first.' };

  const projectIds = links.map((l) => l.project_id);
  const [projectTracks, assets] = await Promise.all([
    selectIn<ProjectTrackRow>((ids) => admin.from('project_tracks').select('project_id, track_id, added_at').in('project_id', ids).order('position', { ascending: true }), projectIds),
    loadPortalAssets(admin, userId, projectIds),
  ]);

  const count = countUnnotified(
    links.map((l) => ({ projectId: l.project_id, linkedAt: l.created_at, lastNotifiedAt: l.last_notified_at })),
    projectTracks.map((pt) => ({ projectId: pt.project_id, trackId: pt.track_id, addedAt: pt.added_at })),
    toPortalFileRows(assets),
  );
  if (count.total === 0 && !opts.force) {
    return { ok: false, status: 409, error: 'Nothing new since the last notify.' };
  }

  // Titles: every track of a new project, plus the new tracks elsewhere.
  const newProjectSet = new Set(count.newProjects);
  if (count.total === 0 && opts.force && opts.focusProjectId && projectIds.includes(opts.focusProjectId)) {
    newProjectSet.add(opts.focusProjectId);
  }
  const trackIdsByProject = new Map<string, string[]>();
  for (const pt of projectTracks) {
    const isNew = newProjectSet.has(pt.project_id) || count.newTracks.some((t) => t.projectId === pt.project_id && t.trackId === pt.track_id);
    if (!isNew) continue;
    const list = trackIdsByProject.get(pt.project_id) ?? [];
    if (!list.includes(pt.track_id)) list.push(pt.track_id);
    trackIdsByProject.set(pt.project_id, list);
  }
  const fileLabelsByProject = new Map<string, string[]>();
  for (const f of count.newFiles) {
    const label = assets.find((a) => a.id === f.fileId)?.label || 'Untitled file';
    fileLabelsByProject.set(f.projectId, [...(fileLabelsByProject.get(f.projectId) ?? []), label]);
  }
  const allTrackIds = [...new Set([...trackIdsByProject.values()].flat())];
  const tracks = allTrackIds.length
    ? await selectIn<{ id: string; title: string | null }>((ids) => admin.from('tracks').select('id, title').in('id', ids).eq('user_id', userId), allTrackIds)
    : [];
  const title = new Map(tracks.map((t) => [t.id, t.title ?? 'Untitled']));
  const nameOf = new Map(projects.map((p) => [p.id, p.name ?? 'Untitled project']));

  const { data: profile } = await admin
    .from('creator_profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();

  const url = portalUrl(portal.token);
  const digest = buildPortalDigest({
    artistName: contact.name ?? '',
    producerName: (profile as { display_name?: string | null } | null)?.display_name ?? '',
    portalUrl: url,
    message: opts.message,
    projects: projectIds
      .filter((id) => newProjectSet.has(id) || trackIdsByProject.has(id) || fileLabelsByProject.has(id))
      .map((id) => ({
        name: nameOf.get(id) ?? 'Untitled project',
        isNewProject: newProjectSet.has(id),
        trackTitles: (trackIdsByProject.get(id) ?? []).map((t) => title.get(t) ?? 'Untitled'),
        fileLabels: newProjectSet.has(id) ? [] : fileLabelsByProject.get(id) ?? [],
      })),
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data: sent, error: sendErr } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: contact.email,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
  if (sendErr) return { ok: false, status: 502, error: sendErr.message || 'Email send failed' };
  const resendId = (sent as { id?: string } | null)?.id ?? null;

  // The email went out. Record it; failures below are logged by the caller,
  // never turned into a failed notify (that would invite a second email).
  const now = (opts.now ?? new Date()).toISOString();
  const notifiedProjectIds = projectIds.filter((id) => newProjectSet.has(id) || trackIdsByProject.has(id) || fileLabelsByProject.has(id));
  await admin
    .from('project_contacts')
    .update({ last_notified_at: now })
    .eq('contact_id', contact.id)
    .eq('user_id', userId)
    .in('project_id', notifiedProjectIds);

  const { data: send } = await admin
    .from('beat_sends')
    .insert(buildProjectSendRow({
      contactId: contact.id,
      trackIds: allTrackIds,
      shareToken: portal.token,
      message: opts.message ?? '',
      campaignId: null,
      emailResendId: resendId,
    }))
    .select('id')
    .single();

  await admin.from('contact_activity').insert({
    contact_id: contact.id,
    user_id: userId,
    kind: 'artist_notified',
    title: digest.itemCount > 0 ? `Notified about ${digest.itemCount} new` : 'Sent the portal link',
    body: opts.message?.trim() || null,
    metadata: { beat_send_id: (send as { id?: string } | null)?.id ?? null, project_ids: notifiedProjectIds, track_ids: allTrackIds, file_ids: count.newFiles.map((f) => f.fileId) },
    occurred_at: now,
  });

  return { ok: true, itemCount: digest.itemCount, beatSendId: (send as { id?: string } | null)?.id ?? null, resendId, recipient: contact.email };
}
