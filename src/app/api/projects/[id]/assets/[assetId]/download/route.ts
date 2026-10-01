import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { assetDownloadName } from '@/lib/projects/assets';
import { streamProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.assets.download');

/** GET /api/projects/[id]/assets/[assetId]/download[?inline=1] — the producer's copy. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  try {
    const { data, error } = await auth.admin
      .from('project_assets')
      .select('url, label, file_name, mime')
      .eq('id', assetId)
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const row = data as { url: string; label: string; file_name: string; mime: string | null };
    return streamProjectAsset(req, row.url, {
      fileName: assetDownloadName(row.label, row.file_name),
      mime: row.mime,
      inline: req.nextUrl.searchParams.get('inline') === '1',
    });
  } catch (err) {
    log.error('download failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
