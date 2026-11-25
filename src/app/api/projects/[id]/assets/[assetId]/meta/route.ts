import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { DAW_EXTENSIONS, DAW_SNIFF_BYTES, DAW_APP_LABEL, dawOf } from '@/lib/projects/daw';
import { DAW_META_HEAD_BYTES, readDawMetadata } from '@/lib/projects/daw-meta';
import { fileExtension } from '@/lib/projects/assets';
import { readProjectAssetHead } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.projects.assets.meta');

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * GET /api/projects/[id]/assets/[assetId]/meta — what a DAW project file says
 * about itself: `{ app, appVersion, bpm }` and NOTHING else (no sample paths,
 * plugin or track names; see lib/projects/daw-meta). Owner-gated exactly like
 * the download route, reads a bounded head of the object, never the stored
 * reference. 404 for a file that is not a DAW project, an unreadable object or
 * another owner's file.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const auth = await requireRowOwnership('projects', id);
  if (!auth.ok) return auth.res;

  try {
    const { data, error } = await auth.admin
      .from('project_assets')
      .select('url, file_name')
      .eq('id', assetId)
      .eq('project_id', id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const row = data as { url: string; file_name: string };
    const ext = fileExtension(row.file_name);

    if (DAW_EXTENSIONS[ext]) {
      const head = await readProjectAssetHead(row.url, DAW_META_HEAD_BYTES);
      const meta = head ? await readDawMetadata(ext, head) : null;
      if (!meta) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ app: meta.app, appVersion: meta.appVersion, bpm: meta.bpm }, { headers: NO_STORE });
    }
    if (ext === 'zip') {
      const head = await readProjectAssetHead(row.url, DAW_SNIFF_BYTES);
      const bundle = dawOf(row.file_name, head);
      if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ app: DAW_APP_LABEL[bundle.app], appVersion: null, bpm: null }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  } catch (err) {
    log.error('meta failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not read the file' }, { status: 500, headers: NO_STORE });
  }
}
