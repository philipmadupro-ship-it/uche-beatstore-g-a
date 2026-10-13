/**
 * GET /api/org/[orgId]/releases/[releaseId]/export?format=csv|json —
 * distributor-ready metadata for one release (LABEL-34, 09 §4). ERN-aligned
 * column names; an export, not a DDEX feed (lib/labelos/metadata-export.ts
 * holds the field map and the rules).
 *
 * `release.write`: handing the release's metadata to a distributor is part of
 * putting it out. requireObjectAccess on `releases` reads the org from the
 * row and the scope through its project: another org's release, one outside
 * the member's artists, a producer-side id or a missing one is 404; an
 * external project member is not a member of the org and gets 403/404.
 *
 * What goes in the file follows the caller: catalogue facts always, credits
 * (rights data) only with `rights.read`, and then only confirmed ones.
 *
 * Audited BEFORE any data is returned (`release.metadata_exported`, the
 * LABEL-39 pattern for a read that hands data out): if the event cannot be
 * written there is no export. The payload names the format and counts, never
 * the content. Rate-limited per member.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { buildMetadataCsv, buildMetadataJson, exportFileName } from '@/lib/labelos/metadata-export';
import { loadExportInput } from '@/lib/labelos/metadata-export-store';
import { releaseEventSubject } from '@/lib/labelos/releases';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { releaseRow, schemaAware } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.export');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Release export needs Supabase.' });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;

  const format = req.nextUrl.searchParams.get('format') ?? 'csv';
  if (format !== 'csv' && format !== 'json') return json(400, { error: 'format must be csv or json', field: 'format' });
  if (!(await rateLimitDurable(`release-export:${access.object.orgId}:${access.userId}`, 60, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many exports. Try again later.' });
  }

  const row = await releaseRow(access);
  if (!row.ok) return row.res;
  const { release } = row;

  try {
    const loaded = await loadExportInput(access.admin, release, access.capabilities.has('rights.read'));
    const input = { ...loaded, generatedAt: new Date() };
    const body = format === 'json' ? JSON.stringify(buildMetadataJson(input), null, 2) : buildMetadataCsv(input);

    // Audit class (see AUDIT_VERBS): throws if it cannot be written, and then nothing is returned.
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'release.metadata_exported',
      releaseEventSubject(release),
      { format, tracks: loaded.items.length, contributors: loaded.includeRights },
    );

    return new NextResponse(body, {
      headers: {
        ...NO_STORE,
        'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(release.title, format)}"`,
      },
    });
  } catch (err) {
    log.error('release export failed', { orgId, releaseId, error: errorMessage(err) });
    return json(500, { error: 'Could not export the release metadata' });
  }
}
