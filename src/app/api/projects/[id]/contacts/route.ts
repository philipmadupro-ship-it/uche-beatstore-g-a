import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectContactLinkBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { selectIn } from '@/lib/db/chunked-in';
import { countUnnotified } from '@/lib/artist-portal/new-items';
import { isDecision } from '@/lib/contacts/decisions';
import { isSchemaNotReady, schemaNotReadyResponse } from '@/lib/artists/http';
import { portalUrl } from '@/lib/artists/portal-send';
import { loadPortalAssets, toPortalFileRows } from '@/lib/artist-portal/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.contacts');

/**
 * GET  /api/projects/[id]/contacts — the project's Artists strip: each linked
 *      contact with portal state, their unnotified count, and every linked
 *      artist's decision on each of this project's tracks.
 * POST /api/projects/[id]/contacts — link a contact { contact_id, role?, in_portal?, allow_downloads? }.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Local-store mode (no Supabase): the workspace tables do not exist there.
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, contacts: [], decisions: {} });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const { data: linkData, error: linkErr } = await admin
      .from('project_contacts')
      .select('contact_id, role, in_portal, allow_downloads, can_comment, last_notified_at, created_at')
      .eq('project_id', id)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (linkErr) throw linkErr;
    const links = (linkData ?? []) as Array<{ contact_id: string; role: string; in_portal: boolean; allow_downloads: boolean; can_comment: boolean; last_notified_at: string | null; created_at: string }>;
    const contactIds = links.map((l) => l.contact_id);
    if (contactIds.length === 0) return NextResponse.json({ schemaReady: true, contacts: [], decisions: {} });

    const [contacts, portals, allLinks, projectTracks] = await Promise.all([
      selectIn<{ id: string; name: string; email: string | null; avatar_url: string | null }>((ids) => admin.from('contacts').select('id, name, email, avatar_url').in('id', ids).eq('user_id', userId), contactIds),
      selectIn<{ contact_id: string; token: string; revoked_at: string | null; last_viewed_at: string | null }>((ids) => admin.from('artist_portals').select('contact_id, token, revoked_at, last_viewed_at').in('contact_id', ids).eq('user_id', userId), contactIds),
      selectIn<{ contact_id: string; project_id: string; created_at: string; last_notified_at: string | null }>((ids) => admin.from('project_contacts').select('contact_id, project_id, created_at, last_notified_at').in('contact_id', ids).eq('user_id', userId).eq('in_portal', true), contactIds),
      admin.from('project_tracks').select('track_id').eq('project_id', id),
    ]);
    const trackIds = ((projectTracks.data ?? []) as Array<{ track_id: string }>).map((r) => r.track_id);

    // Archived projects are not in any portal (membership.ts): they are not news.
    const linkedIds = [...new Set(allLinks.map((l) => l.project_id))];
    const archived = new Set((linkedIds.length
      ? await selectIn<{ id: string; status: string | null }>((ids) => admin.from('projects').select('id, status').in('id', ids).eq('user_id', userId), linkedIds)
      : []).filter((p) => p.status === 'archived').map((p) => p.id));
    const liveLinks = allLinks.filter((l) => !archived.has(l.project_id));
    const portalProjectIds = linkedIds.filter((pid) => !archived.has(pid));
    const [portalTracks, states, portalAssets] = await Promise.all([
      portalProjectIds.length
        ? selectIn<{ project_id: string; track_id: string; added_at: string }>((ids) => admin.from('project_tracks').select('project_id, track_id, added_at').in('project_id', ids), portalProjectIds)
        : Promise.resolve([]),
      trackIds.length
        ? selectIn<{ contact_id: string; track_id: string; decision: string | null; set_by: string }>((ids) => admin.from('contact_track_states').select('contact_id, track_id, decision, set_by').in('track_id', ids).eq('user_id', userId).in('contact_id', contactIds), trackIds)
        : Promise.resolve([]),
      loadPortalAssets(admin, userId, portalProjectIds),
    ]);
    const portalFiles = toPortalFileRows(portalAssets);

    const byId = new Map(contacts.map((c) => [c.id, c]));
    const portalOf = new Map(portals.map((p) => [p.contact_id, p]));
    const out = links
      .filter((l) => byId.has(l.contact_id))
      .map((l) => {
        const mine = liveLinks.filter((x) => x.contact_id === l.contact_id);
        const mineIds = new Set(mine.map((x) => x.project_id));
        const notify = countUnnotified(
          mine.map((x) => ({ projectId: x.project_id, linkedAt: x.created_at, lastNotifiedAt: x.last_notified_at })),
          portalTracks.filter((t) => mineIds.has(t.project_id)).map((t) => ({ projectId: t.project_id, trackId: t.track_id, addedAt: t.added_at })),
          portalFiles.filter((f) => mineIds.has(f.projectId)),
        );
        const portal = portalOf.get(l.contact_id) ?? null;
        return {
          contact: byId.get(l.contact_id),
          link: l,
          portal: portal ? { url: portalUrl(portal.token), revoked: !!portal.revoked_at, last_viewed_at: portal.last_viewed_at } : null,
          notifyCount: notify.total,
        };
      });

    const decisions: Record<string, Array<{ contact_id: string; decision: string; set_by: string }>> = {};
    for (const s of states) {
      if (!isDecision(s.decision)) continue;
      (decisions[s.track_id] ??= []).push({ contact_id: s.contact_id, decision: s.decision, set_by: s.set_by });
    }

    return NextResponse.json({ schemaReady: true, contacts: out, decisions });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ schemaReady: false, contacts: [], decisions: {} });
    log.error('GET failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, ProjectContactLinkBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const { data: contact, error: cErr } = await admin
      .from('contacts')
      .select('id, name')
      .eq('id', body.contact_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const { data, error } = await admin
      .from('project_contacts')
      .upsert({
        user_id: userId,
        project_id: id,
        contact_id: body.contact_id,
        role: body.role,
        in_portal: body.in_portal,
        allow_downloads: body.allow_downloads,
      }, { onConflict: 'project_id,contact_id', ignoreDuplicates: true })
      .select('contact_id, role, in_portal, allow_downloads, can_comment, last_notified_at, created_at');
    if (error) throw error;

    const created = (data ?? []).length > 0;
    if (!created) {
      const { data: existing } = await admin
        .from('project_contacts')
        .select('contact_id, role, in_portal, allow_downloads, can_comment, last_notified_at, created_at')
        .eq('project_id', id)
        .eq('contact_id', body.contact_id)
        .eq('user_id', userId)
        .maybeSingle();
      return NextResponse.json({ link: existing, created: false });
    }
    return NextResponse.json({ link: (data ?? [])[0], created: true }, { status: 201 });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('POST failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
