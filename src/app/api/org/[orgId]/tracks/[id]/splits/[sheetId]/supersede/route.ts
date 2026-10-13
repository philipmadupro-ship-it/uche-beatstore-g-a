/**
 * POST /api/org/[orgId]/tracks/[id]/splits/[sheetId]/supersede — start the
 * next version of a sheet that is in force (LABEL-28). `rights.write`.
 *
 * A circulated, signed or disputed sheet never changes. Revising it makes a
 * NEW draft (version + 1) that copies its lines, unsigned. The old version
 * stays in force — with its signatures — until the new one is circulated;
 * that move (…/circulate) supersedes it, atomically. So a half-edited
 * revision never leaves the song without a sheet in force.
 *
 * 409 when the sheet is not in force (a draft is edited, not superseded; a
 * superseded one already has a successor), or when a draft of this song and
 * kind already exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { isLive, isSplitKind } from '@/lib/labelos/splits';
import { createDraft, loadSheetViews, readSheet, splitEventSubject, SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.splits.supersede');

type Params = { params: Promise<{ orgId: string; id: string; sheetId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId, id, sheetId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'rights.write', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;

  try {
    const sheet = await readSheet(admin, org, id, sheetId);
    if (!sheet) return json(404, { error: 'Not found' });
    if (!isLive(sheet.status) || !isSplitKind(sheet.kind)) {
      return json(409, { error: sheet.status === 'draft' ? 'A draft is edited, not superseded' : 'This version has already been replaced' });
    }

    const made = await createDraft(admin, {
      org,
      actor: access.userId,
      trackId: id,
      kind: sheet.kind,
      note: null,
      lines: null,
      copyFrom: sheet.id,
    });
    if ('error' in made) {
      if (made.error === 'draft_exists') return json(409, { error: `There is already a ${sheet.kind} draft for this song. Finish or discard it first.` });
      return json(404, { error: 'Not found' });
    }

    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'split_sheet.created',
      await splitEventSubject(admin, org, id, made.sheet.id),
      { kind: sheet.kind, version: made.sheet.version, from_version: sheet.version },
    );

    const [view] = await loadSheetViews(admin, org, id, { userId: access.userId, caps: access.capabilities }, made.sheet.id);
    return json(201, { sheet: view });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split supersede failed', { orgId: org, sheetId, error: errorMessage(err) });
    return json(500, { error: 'Could not start a new version' });
  }
}
