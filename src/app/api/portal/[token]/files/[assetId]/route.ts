import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal } from '@/lib/artist-portal/gate';
import { portalProjectLinks } from '@/lib/artist-portal/membership';
import { isSchemaNotReady } from '@/lib/artists/http';
import { assetDownloadName } from '@/lib/projects/assets';
import { streamProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.portal.files');

/**
 * GET /api/portal/[token]/files/[assetId][?inline=1]
 *
 * A project file, streamed after the gate and membership: the file must be
 * `in_portal` and its project must be in this portal (linked, in_portal, not
 * archived). Anything else is 404 — never reveal what exists outside the
 * portal. Putting a file in the portal IS the permission to download it; the
 * project's "Downloads" switch governs its tracks. Each download (not an
 * inline view) lands on the contact's timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; assetId: string }> }) {
  const { token, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await rateLimitDurable(`portalfile:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const admin = createServiceClient();
    const gate = await gatePortal(admin, token, req);
    if (!gate.ok) return gate.res;
    const portal = gate.portal;

    const { data, error } = await admin
      .from('project_assets')
      .select('id, project_id, url, label, file_name, mime, in_portal')
      .eq('id', assetId)
      .eq('user_id', portal.user_id)
      .maybeSingle();
    if (error) throw error;
    const asset = data as { id: string; project_id: string; url: string; label: string; file_name: string; mime: string | null; in_portal: boolean } | null;
    if (!asset || !asset.in_portal) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const links = await portalProjectLinks(admin, portal);
    if (!links.some((l) => l.project_id === asset.project_id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const inline = req.nextUrl.searchParams.get('inline') === '1';
    if (!inline) {
      const { error: actErr } = await admin.from('contact_activity').insert({
        contact_id: portal.contact_id,
        user_id: portal.user_id,
        kind: 'file_downloaded',
        title: `Downloaded ${asset.label || asset.file_name || 'a file'}`,
        metadata: { asset_id: asset.id, project_id: asset.project_id, source: 'portal' },
      });
      if (actErr) log.warn('file download timeline row failed', { error: errorMessage(actErr) });
    }

    return streamProjectAsset(req, asset.url, {
      fileName: assetDownloadName(asset.label, asset.file_name),
      mime: asset.mime,
      inline,
    });
  } catch (err) {
    if (isSchemaNotReady(err)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    log.error('portal file failed', { assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
