/**
 * PATCH / DELETE /api/org/[orgId]/tracks/[id]/splits/[sheetId] — edit or
 * discard a DRAFT split sheet (LABEL-28). `rights.write`.
 *
 *   PATCH `{ note?, lines? }`: `lines` replaces the whole set in one
 *         transaction (the form posts what it shows). A draft may be
 *         incomplete — the 100.0000 rule is held at circulation.
 *   DELETE discards a draft.
 *
 * A circulated, signed, disputed or superseded sheet is a record: 409, and
 * migration 155's triggers refuse it again if this check were ever skipped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgSplitPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { isSplitKind } from '@/lib/labelos/splits';
import {
  deleteDraft,
  loadSheetViews,
  readSheet,
  resolveLines,
  saveDraft,
  splitEventSubject,
  SplitsNotReadyError,
} from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.splits.id');

type Params = { params: Promise<{ orgId: string; id: string; sheetId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const LOCKED = 'This version has been circulated and can no longer be edited. Start a new version instead.';

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, id, sheetId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'rights.write', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;

  const parsed = await readBody(req, OrgSplitPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const sheet = await readSheet(admin, org, id, sheetId);
    if (!sheet) return json(404, { error: 'Not found' });
    if (sheet.status !== 'draft') return json(409, { error: LOCKED });
    if (!isSplitKind(sheet.kind)) return json(500, { error: 'Could not edit the split sheet' });

    let lines;
    if (body.lines) {
      const resolved = await resolveLines(admin, org, sheet.kind, body.lines);
      if (!resolved.ok) return json(resolved.status, { error: resolved.error });
      lines = resolved.lines;
    }
    const saved = await saveDraft(admin, {
      org,
      sheetId,
      note: body.note === undefined ? undefined : body.note?.trim() ? body.note.trim() : null,
      lines,
    });
    if ('error' in saved) return saved.error === 'not_draft' ? json(409, { error: LOCKED }) : json(404, { error: 'Not found' });

    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'split_sheet.updated',
      await splitEventSubject(admin, org, id, sheetId),
      // Which parts changed, never the shares.
      { kind: sheet.kind, version: sheet.version, lines: body.lines !== undefined, note: body.note !== undefined },
    );

    const [view] = await loadSheetViews(admin, org, id, { userId: access.userId, caps: access.capabilities }, sheetId);
    return json(200, { sheet: view });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split edit failed', { orgId: org, sheetId, error: errorMessage(err) });
    return json(500, { error: 'Could not edit the split sheet' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, sheetId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'rights.write', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;

  try {
    const sheet = await readSheet(admin, org, id, sheetId);
    if (!sheet) return json(404, { error: 'Not found' });
    const subject = await splitEventSubject(admin, org, id, sheetId);
    const result = await deleteDraft(admin, org, id, sheetId);
    if (result === 'not_found') return json(404, { error: 'Not found' });
    if (result === 'not_draft') return json(409, { error: 'Only a draft can be discarded. Start a new version to replace a circulated sheet.' });
    await recordEvent(admin, { orgId: org, userId: access.userId }, 'split_sheet.deleted', subject, { kind: sheet.kind, version: sheet.version });
    return json(200, { deleted: true });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split discard failed', { orgId: org, sheetId, error: errorMessage(err) });
    return json(500, { error: 'Could not discard the draft' });
  }
}
