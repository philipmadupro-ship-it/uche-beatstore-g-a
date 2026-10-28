import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { loadPublicRelease } from '@/lib/labelos/store-listing-store';
import { streamProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.releases.cover');

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

/**
 * GET /api/store/releases/[id]/cover (LABEL-42) — the release's artwork.
 * Artwork lives as a private project file; it is streamed through here only
 * while the release is listed, only when it is the release's own artwork or
 * photo file, NOT restricted, and a plain raster image. Anything else is 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  // Lower-cased once: every key below (cache, limiter) is a lowercase UUID, so letter case multiplies nothing.
  const id = rawId.toLowerCase();
  try {
    if (!isSupabaseConfigured() || !isUUID(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const admin = createServiceClient();
    const loaded = await loadPublicRelease(admin, id, new Date());
    if (!loaded?.release.artwork_asset_id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data } = await admin
      .from('project_assets')
      .select('url, file_name, mime, kind, sensitivity, project_id, org_id')
      .eq('id', loaded.release.artwork_asset_id)
      .eq('org_id', loaded.release.org_id)
      .maybeSingle();
    const asset = data as { url: string; file_name: string; mime: string | null; kind: string; sensitivity: string | null; project_id: string } | null;
    if (
      !asset ||
      asset.project_id !== loaded.release.project_id ||
      !['artwork', 'photo'].includes(asset.kind) ||
      asset.sensitivity === 'restricted' ||
      !asset.mime ||
      !IMAGE.test(asset.mime)
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const upstream = await streamProjectAsset(req, asset.url, { fileName: asset.file_name, mime: asset.mime, inline: true });
    const headers = new Headers(upstream.headers);
    headers.set('cache-control', loaded.consentGoverned ? 'no-store' : 'public, max-age=60, s-maxage=60');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('cover failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Cover unavailable' }, { status: 500 });
  }
}
