/**
 * POST /api/org/[orgId]/tracks/[id]/splits/[sheetId]/circulate — send a draft
 * out for signature (LABEL-28). `rights.write`.
 *
 * The gate is the 100.0000 rule: the lines must exist, use roles of the
 * sheet's kind, name nobody twice, and add up to exactly 100 — in integer
 * units (lib/labelos/splits), so 33.3333 × 3 (99.9999) is refused with the
 * missing amount named, 422. The database re-checks the same rule in its
 * trigger.
 *
 * One Postgres function (migration 155, `labelos_audit_split_circulate`)
 * does the move AND writes `split_sheet.circulated` in one transaction. If
 * another version of this song and kind is in force it becomes `superseded`
 * in the same transaction, with its own `split_sheet.superseded` event: a new
 * version replaces the old one atomically, and two versions are never live.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, isMissingAuditRpc, SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { isSplitKind, unitsOf, validateSheet } from '@/lib/labelos/splits';
import { auditSubject, linesOfSheets, loadSheetViews, readSheet, splitEventSubject, SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.splits.circulate');

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
    if (sheet.status !== 'draft' || !isSplitKind(sheet.kind)) return json(409, { error: 'Only a draft can be circulated' });

    const lines = (await linesOfSheets(admin, org, [sheetId])).get(sheetId) ?? [];
    const check = validateSheet(sheet.kind, lines.map((l) => ({ partyId: l.party_id, role: l.role, units: unitsOf(l.share) })));
    if (!check.ok) {
      return json(422, { error: check.issues[0].message, issues: check.issues, total: check.total, remaining: check.remaining });
    }

    const subject = await splitEventSubject(admin, org, id, sheetId);
    const { data, error } = await auditRpc(admin, 'splitCirculate', {
      p_org: org,
      p_actor: access.userId,
      p_sheet: sheetId,
      p_subject: auditSubject(subject),
      // Which sheet, never who owns what.
      p_payload: { kind: sheet.kind, version: sheet.version, lines: lines.length },
    });
    if (error) {
      if (isMissingAuditRpc(error)) return json(503, { error: SPLITS_NOT_READY });
      log.error('split circulate failed', { orgId: org, sheetId, error: error.message });
      return json(500, { error: 'Could not circulate the split sheet' });
    }
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    if (data?.error === 'not_draft') return json(409, { error: 'Only a draft can be circulated' });
    if (data?.error === 'no_lines') return json(422, { error: 'Add at least one line.' });
    if (data?.error === 'bad_total') return json(422, { error: 'The shares do not add up to 100%.' });

    const [view] = await loadSheetViews(admin, org, id, { userId: access.userId, caps: access.capabilities }, sheetId);
    return json(200, { sheet: view, supersededId: (data?.superseded as string | null) ?? null });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split circulate failed', { orgId: org, sheetId, error: errorMessage(err) });
    return json(500, { error: 'Could not circulate the split sheet' });
  }
}
