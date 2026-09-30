import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectLinks } from '@/lib/artist-portal/membership';
import { loadPortalAssets } from '@/lib/artist-portal/files';
import { pulseVersions } from '@/lib/artist-portal/pulse';
import { isSchemaNotReady } from '@/lib/artists/http';
import { isMissingSchema } from '@/lib/artists/workspace-load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.pulse');

async function tolerant<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return data ?? [];
}

/**
 * GET /api/portal/[token]/pulse — three fingerprints (library, comments,
 * messages) the open portal polls to notice new material without reloading
 * (lib/artist-portal/pulse). Read-only: it does not count as a visit and
 * moves no watermark. Same gate as every portal route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalpulse:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;
    const links = await portalProjectLinks(admin, portal);
    const projectIds = links.map((l) => l.project_id);

    const [projects, projectTracks, files, states, comments, messages] = await Promise.all([
      projectIds.length
        ? selectIn<{ id: string; name: string | null; cover_url: string | null }>((ids) => admin.from('projects').select('id, name, cover_url').in('id', ids).eq('user_id', portal.user_id), projectIds)
        : Promise.resolve([]),
      projectIds.length
        ? selectIn<{ project_id: string; track_id: string }>((ids) => admin.from('project_tracks').select('project_id, track_id').in('project_id', ids), projectIds)
        : Promise.resolve([]),
      loadPortalAssets(admin, portal.user_id, projectIds),
      tolerant<{ track_id: string; decision: string | null }>(admin.from('contact_track_states').select('track_id, decision').eq('contact_id', portal.contact_id).eq('user_id', portal.user_id)),
      projectIds.length
        ? tolerant<{ id: string }>(admin.from('project_comments').select('id').in('project_id', projectIds).eq('contact_id', portal.contact_id).is('deleted_at', null).limit(1000))
        : Promise.resolve([]),
      tolerant<{ id: string; request_status: string | null }>(admin.from('artist_messages').select('id, request_status').eq('contact_id', portal.contact_id).eq('user_id', portal.user_id).limit(1000)),
    ]);

    return NextResponse.json(
      pulseVersions({ links, projects, projectTracks, files, states, comments, messages }),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    log.error('pulse failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
