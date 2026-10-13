/**
 * POST /api/org/[orgId]/tracks/[id]/splits/[sheetId]/signatures — record a
 * signature on a circulated split sheet (LABEL-28). Two methods:
 *
 *   JSON `{ method: 'acknowledged', line_id }`  the person named on the line
 *        says it is right. Only they can — nobody acknowledges for someone
 *        else — org member or external project member alike (D2).
 *   multipart `file` (+ `line_id`?)             a signed PDF. `rights.write`
 *        only. It is stored as a RESTRICTED `project_assets` row of kind
 *        `split_sheet` in the song's project (so it needs `contracts.read`
 *        to open again, and every download is an audit event, LABEL-15). With
 *        `line_id` it signs that line; without, every unsigned line (one PDF
 *        signed by everyone). Up to 4 MB, PDF only.
 *
 * One Postgres function (155, `labelos_audit_split_sign`) writes the
 * signature(s), turns the sheet `signed` when the last line is in, and
 * records `split_sheet.signed`, in one transaction. If it refuses, the stored
 * file is removed again.
 *
 * A line that is not the caller's, for a caller without `rights.write`, is
 * 404 (D2): it does not exist for them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireTrackActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgSplitAcknowledgeBodySchema, OrgSplitUploadFieldsSchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { fileEventVisibility, recordEvent } from '@/lib/labelos/activity';
import { auditRpc, isMissingAuditRpc, SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { creditActorOf } from '@/lib/labelos/credit-actor';
import { creditReach } from '@/lib/labelos/credits';
import { partiesByIds } from '@/lib/labelos/credits-store';
import { canWriteOrgAsset, orgAssetObjectKey } from '@/lib/labelos/org-assets';
import { planSignature, type SplitSignatureMethod } from '@/lib/labelos/splits';
import {
  auditSubject,
  insertSignedPdfRow,
  linesOfSheets,
  loadSheetViews,
  readSheet,
  removeAssetRow,
  splitEventSubject,
  SplitsNotReadyError,
} from '@/lib/labelos/splits-store';
import { assetValidationMessage, MAX_DIRECT_UPLOAD_BYTES, validateAssetFile } from '@/lib/projects/assets';
import { deleteProjectAssetObject, storeProjectAsset } from '@/lib/storage/project-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.splits.signatures');

type Params = { params: Promise<{ orgId: string; id: string; sheetId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id, sheetId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);
  if (creditReach(actor) === 'none') return json(403, { error: 'Forbidden' });

  // The request: JSON for an acknowledgement, multipart for a signed PDF.
  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
  let method: SplitSignatureMethod;
  let lineId: string | null = null;
  let file: File | null = null;
  if (multipart) {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!form || !(f instanceof File)) return json(400, { error: 'No file provided' });
    const fields = OrgSplitUploadFieldsSchema.safeParse({ line_id: form.get('line_id') || undefined });
    if (!fields.success) return json(400, { error: fields.error.issues[0]?.message ?? 'Invalid fields' });
    method = 'upload';
    lineId = fields.data.line_id?.toLowerCase() ?? null;
    file = f;
  } else {
    const parsed = OrgSplitAcknowledgeBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    method = 'acknowledged';
    lineId = parsed.data.line_id.toLowerCase();
  }

  let storedUrl: string | null = null;
  let assetId: string | null = null;
  try {
    const sheet = await readSheet(admin, org, id, sheetId);
    if (!sheet) return json(404, { error: 'Not found' });
    const lines = (await linesOfSheets(admin, org, [sheetId])).get(sheetId) ?? [];
    const parties = await partiesByIds(admin, org, lines.map((l) => l.party_id));

    // Which line(s): one the caller named, or (a signed PDF) every unsigned one.
    const target = lineId ? lines.find((l) => l.id === lineId) : null;
    if (lineId && !target) return json(404, { error: 'Not found' });
    const facts = target
      ? { partyUserId: parties.get(target.party_id)?.user_id ?? null, signed: !!target.signed_at }
      : { partyUserId: null, signed: lines.every((l) => !!l.signed_at) };
    const plan = planSignature(actor, method, sheet.status, facts);
    if (!plan.ok) return json(plan.status, { error: plan.error });

    const subject = await splitEventSubject(admin, org, id, sheetId);
    let p_asset: string | null = null;
    if (file) {
      if (!subject.projectId) return json(409, { error: 'Put the song in a project to attach a signed document, or have each person acknowledge their line.' });
      if (access.kind !== 'org' || !canWriteOrgAsset(access.access.capabilities, { kind: 'split_sheet', sensitivity: 'restricted' })) {
        return json(403, { error: 'You cannot upload a signed document' });
      }
      if (file.size > MAX_DIRECT_UPLOAD_BYTES) return json(413, { error: 'A signed PDF can be up to 4 MB here.' });
      const check = validateAssetFile({ name: file.name, size: file.size }, { org: true });
      if (!check.ok) return json(check.error === 'too-large' ? 413 : 415, { error: assetValidationMessage(check.error, { org: true }) });
      if (check.extension !== 'pdf') return json(415, { error: 'A signed split sheet is a PDF.' });
      storedUrl = await storeProjectAsset(Buffer.from(await file.arrayBuffer()), orgAssetObjectKey(org, subject.projectId, nanoid(16), 'pdf'), 'application/pdf');
      assetId = await insertSignedPdfRow(admin, {
        org,
        projectId: subject.projectId,
        createdBy: actor.userId,
        url: storedUrl,
        fileName: file.name,
        size: file.size,
        label: `Split sheet · ${sheet.kind} v${sheet.version}`,
      });
      p_asset = assetId;
    }

    const { data, error } = await auditRpc(admin, 'splitSign', {
      p_org: org,
      p_actor: actor.userId,
      p_sheet: sheetId,
      p_line: lineId,
      p_method: method,
      p_asset,
      p_subject: auditSubject(subject),
      p_payload: { kind: sheet.kind, version: sheet.version, method },
    });
    const refused = !!error || !!data?.error;
    if (refused && assetId) {
      await removeAssetRow(admin, org, assetId).catch(() => {});
      if (storedUrl) await deleteProjectAssetObject(storedUrl).catch(() => {});
    }
    if (error) {
      if (isMissingAuditRpc(error)) return json(503, { error: SPLITS_NOT_READY });
      log.error('split sign failed', { orgId: org, sheetId, error: error.message });
      return json(500, { error: 'Could not record the signature' });
    }
    if (data?.error === 'not_found' || data?.error === 'no_line') return json(404, { error: 'Not found' });
    if (data?.error === 'not_circulated') return json(409, { error: 'This version is no longer open for signatures' });
    if (data?.error === 'already_signed') return json(409, { error: 'Already signed' });
    if (data?.error) return json(400, { error: 'Could not record the signature' });

    if (assetId) {
      await recordEvent(
        admin,
        { orgId: org, userId: actor.userId },
        'file.uploaded',
        { type: 'asset', id: assetId, projectId: subject.projectId },
        { kind: 'split_sheet', sensitivity: 'restricted' },
        { visibility: fileEventVisibility('restricted') },
      );
    }

    const [view] = await loadSheetViews(admin, org, id, actor, sheetId);
    return json(200, { sheet: view ?? null, complete: data?.complete === true });
  } catch (err) {
    if (assetId) {
      await removeAssetRow(admin, org, assetId).catch(() => {});
      if (storedUrl) await deleteProjectAssetObject(storedUrl).catch(() => {});
    } else if (storedUrl) {
      await deleteProjectAssetObject(storedUrl).catch(() => {});
    }
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split sign failed', { orgId: org, sheetId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the signature' });
  }
}
