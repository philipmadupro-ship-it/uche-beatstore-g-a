/**
 * GET /api/org/[orgId]/export?format=json|csv — the owner's copy of
 * everything the organization holds (LABEL-39).
 *
 *  - `json` (default): one document `{ manifest, tables }`.
 *  - `csv`: a zip with one CSV per table and `manifest.json`.
 *
 * The manifest lists the object keys the rows point at and what the object
 * store holds under `orgs/<org_id>/`; audio and files are NOT inside the
 * export, they are fetched separately by key (the export is data, not a
 * terabyte of WAVs).
 *
 * Owner only, and only within a few minutes of a fresh sign-in (403
 * `requiresReauth` otherwise). Audited: `org.exported` is written BEFORE any
 * data is returned, so an export that cannot be audited does not happen.
 * Rate-limited, since it reads every table of the org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { strToU8, zipSync } from 'fflate';
import { requireOrgOwner } from '@/lib/auth/org-access';
import { loadEntitlements } from '@/lib/labelos/entitlements-store';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import { buildManifest, exportFileName, toCsv, type StoredObject } from '@/lib/labelos/org-export';
import { gatherOrgExport } from '@/lib/labelos/org-lifecycle-store';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { listOrgObjects, listStoreReleaseObjects, orgReleaseIds } from '@/lib/storage/org-objects';

const log = createLogger('api.org.export');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const owner = await requireOrgOwner(orgId, { state: 'live', freshSignIn: true });
  if (!owner.ok) return owner.res;
  const { admin, org } = owner;
  // Data export is a licensed module (LABEL-47): an org without it has no export route.
  try {
    if (!(await loadEntitlements(admin, org)).modules.has('export')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    log.error('entitlements read failed', { orgId: org.id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not check organization access' }, { status: 500 });
  }

  const format = req.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 });
  }
  if (!(await rateLimitDurable(`org-export:${org.id}`, 6, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many exports. Try again later.' }, { status: 429 });
  }

  const generatedAt = new Date();
  try {
    const tables = await gatherOrgExport(admin, org.id);

    let stored: StoredObject[] | null = null;
    let storedError: string | undefined;
    try {
      stored = [...(await listOrgObjects(org.id)), ...(await listStoreReleaseObjects(await orgReleaseIds(admin, org.id)))];
    } catch (err) {
      storedError = errorMessage(err);
      log.warn('export: object store not listed', { orgId: org.id, error: storedError });
    }
    const manifest = buildManifest({ orgId: org.id, generatedAt, tables, stored, storedError });

    await recordEvent(
      admin,
      { orgId: org.id, userId: owner.userId },
      'org.exported',
      { type: 'org', id: org.id },
      { format, rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0), objects: manifest.stored?.length ?? null },
      { audit: true },
    );

    const fileName = exportFileName(org.slug, format, generatedAt);
    const headers = {
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    };
    if (format === 'json') {
      return new NextResponse(JSON.stringify({ manifest, tables }, null, 2), {
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
    for (const [name, rows] of Object.entries(tables)) files[`${name}.csv`] = strToU8(toCsv(rows));
    return new NextResponse(Buffer.from(zipSync(files)), { headers: { ...headers, 'Content-Type': 'application/zip' } });
  } catch (err) {
    log.error('export failed', { orgId: org.id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not export the organization' }, { status: 500 });
  }
}
