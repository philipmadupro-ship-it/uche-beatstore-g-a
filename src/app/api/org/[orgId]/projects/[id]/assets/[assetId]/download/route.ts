/**
 * GET /api/org/[orgId]/projects/[id]/assets/[assetId]/download[?inline=1]
 *
 * Stream one org project file (LABEL-15) to a member who may open THAT file:
 * scope (404), then lib/labelos/org-assets — working material needs
 * audio.working, a restricted file contracts.read (403 without).
 *
 * A restricted download is an audit event (06 §6, `file.restricted_downloaded`)
 * and is recorded BEFORE a byte is sent: recordEvent throws for an audit
 * verb, so if the record cannot be written, nothing is downloaded.
 *
 * The stored reference must be this org project's own key in the private
 * bucket (or `data/orgs/…` locally), or the file is treated as missing.
 * Nothing is presigned; the bytes stream through streamProjectAsset with
 * the MIME stored at upload and `nosniff`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { assetDownloadName } from '@/lib/projects/assets';
import { orgProjectAssetKeyOf } from '@/lib/labelos/org-assets';
import { projectAssetBuckets, streamProjectAsset } from '@/lib/storage/project-assets';
import { orgAssetRow } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.assets.download');

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string; id: string; assetId: string }> }) {
  const { orgId, id, assetId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await requireObjectAccess({ table: 'project_assets', id: assetId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const found = await orgAssetRow(access, id, 'read');
  if (!found.ok) return found.res;
  const { row } = found;
  const org = access.object.orgId;

  if (!orgProjectAssetKeyOf(row.url, org, row.project_id, projectAssetBuckets())) {
    log.error('stored reference is not this project’s org file', { assetId });
    return NextResponse.json({ error: 'File unavailable' }, { status: 404 });
  }

  const inline = req.nextUrl.searchParams.get('inline') === '1';
  try {
    if (row.sensitivity !== 'normal') {
      await recordEvent(
        access.admin,
        { orgId: org, userId: access.userId },
        'file.restricted_downloaded',
        { type: 'asset', id: row.id, projectId: row.project_id },
        { kind: row.kind, inline },
      );
    }
    return await streamProjectAsset(req, row.url, {
      fileName: assetDownloadName(row.label, row.file_name),
      mime: row.mime,
      inline,
    });
  } catch (err) {
    log.error('download failed', { id, assetId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
