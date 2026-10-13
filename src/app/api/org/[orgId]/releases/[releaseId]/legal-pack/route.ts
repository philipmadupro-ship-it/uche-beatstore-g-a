/**
 * GET /api/org/[orgId]/releases/[releaseId]/legal-pack[?format=zip|csv]
 *
 * The legal pack of a release (LABEL-31, 09 §3.3): `legal-pack.csv` — one row
 * per split line of the sheet in force, then credits not yet on a split, with
 * the columns of lib/labelos/legal-pack — and the documents behind it
 * (signed split sheets, sample clearances) under `documents/`, in one zip.
 * `?format=csv` is the CSV alone.
 *
 * Who: `contracts.read` AND `rights.read` (the file holds restricted
 * documents and legal names / IPIs, D2) on a release the member can open — a
 * release outside their artist scope, another org's, a producer row or a
 * missing id is 404; lacking the capability is 403. External project members
 * never get here (requireObjectAccess answers "not a member").
 *
 * Audited: `release.legal_pack_exported` is an audit verb, written BEFORE
 * the first byte is returned (recordEvent throws for an audit verb, so a pack
 * that cannot be audited is not handed out). Files are read from the private
 * store by the server and written into the archive; no URL is returned.
 *
 * Zip: fflate (already used for the linked-material zip and the org export),
 * entries STORED, streamed one at a time — see the PR for the evaluation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { recordEvent } from '@/lib/labelos/activity';
import { CreditsNotReadyError } from '@/lib/labelos/credits-store';
import { legalPackCsv, legalPackFileName, legalPackRows, packReadme } from '@/lib/labelos/legal-pack';
import { gatherLegalPack } from '@/lib/labelos/legal-pack-store';
import { canExportLegalPack } from '@/lib/labelos/legal-queue';
import { LegalReadinessNotReadyError } from '@/lib/labelos/legal-readiness-store';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { SplitsNotReadyError } from '@/lib/labelos/splits-store';
import { openProjectAsset } from '@/lib/storage/project-assets';
import { zipStream } from '@/lib/tracks/zip-stream';
import { releaseRow, schemaAware } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.legal-pack');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store, private' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const enc = new TextEncoder();

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The legal pack needs Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'contracts.read', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  if (!canExportLegalPack(access.capabilities)) return json(403, { error: 'Forbidden' });

  const format = req.nextUrl.searchParams.get('format') ?? 'zip';
  if (format !== 'zip' && format !== 'csv') return json(400, { error: 'format must be zip or csv' });

  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const { release } = found;

  if (!(await rateLimitDurable(`legal-pack:${access.orgId}:${access.userId}`, 20, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many exports. Try again later.' });
  }

  try {
    const data = await gatherLegalPack(access, release.id);
    const rows = legalPackRows(data.songs, data.parties);
    const generatedAt = new Date();

    // The audit comes first: if it cannot be written, nothing is returned.
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'release.legal_pack_exported',
      releaseEventSubject(release),
      {
        format,
        songs: data.songs.length,
        rows: rows.length,
        documents: format === 'zip' ? data.documents.length : 0,
        songs_not_included: data.songsNotIncluded,
      },
    );

    const csv = legalPackCsv(rows);
    const fileName = legalPackFileName(release.title, generatedAt, format);
    const headers = {
      ...NO_STORE,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'X-Content-Type-Options': 'nosniff',
    };
    if (format === 'csv') {
      return new NextResponse(csv, { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
    }

    const readme = packReadme({
      releaseTitle: release.title,
      generatedAt,
      rows: rows.length,
      documents: data.documents,
      missingDocuments: data.missingDocuments,
      songsNotIncluded: data.songsNotIncluded,
    });
    const body = zipStream(
      [
        { name: 'README.txt', open: async () => enc.encode(readme) },
        { name: 'legal-pack.csv', open: async () => enc.encode(csv) },
        ...data.documents.map((d) => ({ name: d.path, open: () => openProjectAsset(d.ref) })),
      ],
      { onSkip: (name, reason) => log.warn('pack entry skipped', { releaseId: release.id, name, reason }), mtime: generatedAt },
    );
    return new NextResponse(body, { headers: { ...headers, 'Content-Type': 'application/zip' } });
  } catch (err) {
    if (err instanceof LegalReadinessNotReadyError || err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError) {
      return json(503, { error: 'The legal pack needs migrations 153 and 155 applied on Supabase.', schemaReady: false });
    }
    log.error('legal pack failed', { orgId: access.orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not build the legal pack' });
  }
}
