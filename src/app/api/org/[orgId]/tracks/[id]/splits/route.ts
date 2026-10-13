/**
 * /api/org/[orgId]/tracks/[id]/splits — the split sheets of an org song
 * (LABEL-28, 05 §3): composition and master, versioned, each summing to
 * exactly 100.0000 before it can leave draft.
 *
 *   GET   every version the caller may see. `rights.read`: all sheets, all
 *         lines, the total, legal names and IPIs. An own line (a producer /
 *         engineer function, or an external project member, D2): only the
 *         circulated-or-later sheets they are on, and ONLY their own line(s) —
 *         no other name, no other share, no total. Everyone else: 403.
 *   POST  start a draft `{ kind, note?, lines? }` (`rights.write`). One draft
 *         per song and kind (409), version = last + 1. To revise a circulated
 *         sheet use …/[sheetId]/supersede, which copies its lines.
 *
 * Served to org members AND to external members of a project the song sits
 * in for GET (requireTrackActor); writes are org members only — an external
 * member never reaches POST (requireObjectAccess answers them 403 / 404).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, requireTrackActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgSplitCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { creditActorOf } from '@/lib/labelos/credit-actor';
import { canWriteRights, creditReach } from '@/lib/labelos/credits';
import { SPLIT_KIND_LABEL, SPLIT_KINDS, SPLIT_ROLE_LABEL, ROLES_BY_KIND } from '@/lib/labelos/splits';
import { createDraft, loadSheetViews, resolveLines, splitEventSubject, SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.splits');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);
  const reach = creditReach(actor);
  if (reach === 'none') return json(403, { error: 'Forbidden' });

  const vocabulary = {
    kinds: SPLIT_KINDS.map((k) => ({ key: k, label: SPLIT_KIND_LABEL[k], roles: ROLES_BY_KIND[k].map((r) => ({ key: r, label: SPLIT_ROLE_LABEL[r] })) })),
  };
  try {
    const sheets = await loadSheetViews(admin, org, id, actor);
    return json(200, { schemaReady: true, sheets, me: { reach, canWrite: canWriteRights(actor) }, ...vocabulary });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(200, { schemaReady: false, sheets: [], me: { reach, canWrite: false }, ...vocabulary });
    log.error('split list failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not load the split sheets' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Split sheets need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'rights.write', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;

  const parsed = await readBody(req, OrgSplitCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    let lines = null as Awaited<ReturnType<typeof resolveLines>> | null;
    if (body.lines) {
      lines = await resolveLines(admin, org, body.kind, body.lines);
      if (!lines.ok) return json(lines.status, { error: lines.error });
    }
    const made = await createDraft(admin, {
      org,
      actor: access.userId,
      trackId: id,
      kind: body.kind,
      note: body.note?.trim() ? body.note.trim() : null,
      lines: lines?.ok ? lines.lines : null,
      copyFrom: null,
    });
    if ('error' in made) {
      if (made.error === 'draft_exists') return json(409, { error: `There is already a ${body.kind} draft for this song` });
      return json(404, { error: 'Not found' });
    }

    // Everyday event, best effort: the draft is saved either way. Kind and version only.
    await recordEvent(
      admin,
      { orgId: org, userId: access.userId },
      'split_sheet.created',
      await splitEventSubject(admin, org, id, made.sheet.id),
      { kind: body.kind, version: made.sheet.version },
    );

    const actor = { userId: access.userId, caps: access.capabilities };
    const [sheet] = await loadSheetViews(admin, org, id, actor, made.sheet.id);
    return json(201, { sheet });
  } catch (err) {
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('split create failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not start the split sheet' });
  }
}
