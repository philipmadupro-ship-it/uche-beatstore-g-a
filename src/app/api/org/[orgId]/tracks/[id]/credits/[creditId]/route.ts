/**
 * PATCH /api/org/[orgId]/tracks/[id]/credits/[creditId] — confirm or dispute a
 * credit (LABEL-27) `{ action: 'confirm' | 'dispute', note? }`.
 *
 * `rights.write` decides any credit. The credited person decides THEIR OWN
 * (an org member with an own line, or an external project member, D2) — but
 * cannot confirm a credit they proposed themselves. A credit that is not
 * theirs, and not a rights writer's to decide, is 404, not 403.
 *
 * DELETE withdraws a credit (LABEL-54): the credited person takes their name off
 * the song, or a rights writer removes any credit (`planWithdraw`; a credit that
 * is not theirs is 404). The row goes and `credit.withdrawn` is written in the
 * same transaction (migration 174, `labelos_audit_credit_withdraw`).
 *
 * Both are audit events (06 §6): one Postgres function (migration 153,
 * `labelos_audit_credit_decide`) changes the credit AND writes
 * `credit.confirmed` / `credit.disputed` in one transaction; if the event
 * cannot be written the status does not change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTrackActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgCreditDecisionBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { auditRpc, CREDITS_NOT_READY, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { creditView, planDecision, planWithdraw } from '@/lib/labelos/credits';
import { creditEventSubject, CreditsNotReadyError, partiesByIds, readCredit } from '@/lib/labelos/credits-store';
import { creditActorOf } from '@/lib/labelos/credit-actor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.credits.id');

type Params = { params: Promise<{ orgId: string; id: string; creditId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, id, creditId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Credits need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);

  const parsed = await readBody(req, OrgCreditDecisionBodySchema);
  if (!parsed.ok) return parsed.res;
  const decision = parsed.data.action === 'confirm' ? 'confirmed' : 'disputed';

  try {
    const credit = await readCredit(admin, org, id, creditId);
    if (!credit) return json(404, { error: 'Not found' });
    const parties = await partiesByIds(admin, org, [credit.party_id]);
    const party = credit.party_id ? parties.get(credit.party_id) ?? null : null;

    const plan = planDecision(actor, decision, { status: credit.status, createdBy: credit.created_by, partyUserId: party?.user_id ?? null });
    if (!plan.ok) return json(plan.status, { error: plan.error });

    const subject = await creditEventSubject(admin, org, id, credit.id);
    const { data, error } = await auditRpc(admin, 'creditDecide', {
      p_org: org,
      p_actor: actor.userId,
      p_credit: credit.id,
      p_decision: decision,
      p_note: decision === 'disputed' ? parsed.data.note ?? null : null,
      p_subject: { artist_id: subject.artistId ?? null, project_id: subject.projectId ?? null, song_id: subject.songId ?? null },
      // The decision, never the legal data: role and scope say which credit.
      p_payload: { role: credit.role, scope: credit.scope, from: credit.status, to: decision, noted: decision === 'disputed' && !!parsed.data.note },
    });
    if (error) {
      if (isMissingAuditRpc(error)) return json(503, { error: CREDITS_NOT_READY });
      log.error('credit decision failed', { orgId: org, creditId, error: error.message });
      return json(500, { error: 'Could not record the decision' });
    }
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    if (data?.error === 'unchanged') return json(409, { error: decision === 'confirmed' ? 'Already confirmed' : 'Already disputed' });

    const updated = (await readCredit(admin, org, id, credit.id)) ?? credit;
    return json(200, { credit: creditView(updated, party, actor) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('credit decision failed', { orgId: org, creditId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the decision' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, id, creditId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Credits need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);

  try {
    const credit = await readCredit(admin, org, id, creditId);
    if (!credit) return json(404, { error: 'Not found' });
    const parties = await partiesByIds(admin, org, [credit.party_id]);
    const party = credit.party_id ? parties.get(credit.party_id) ?? null : null;

    const plan = planWithdraw(actor, { partyUserId: party?.user_id ?? null });
    if (!plan.ok) return json(plan.status, { error: plan.error });

    const subject = await creditEventSubject(admin, org, id, credit.id);
    const { data, error } = await auditRpc(admin, 'creditWithdraw', {
      p_org: org,
      p_actor: actor.userId,
      p_credit: credit.id,
      p_subject: { artist_id: subject.artistId ?? null, project_id: subject.projectId ?? null, song_id: subject.songId ?? null },
      // Which credit, never the person's legal data: role and scope say what it was.
      p_payload: { role: credit.role, scope: credit.scope, from: credit.status, own: !!party?.user_id && party.user_id === actor.userId },
    });
    if (error) {
      if (isMissingAuditRpc(error)) return json(503, { error: CREDITS_NOT_READY });
      log.error('credit withdraw failed', { orgId: org, creditId, error: error.message });
      return json(500, { error: 'Could not withdraw the credit' });
    }
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    return json(200, { withdrawn: true });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('credit withdraw failed', { orgId: org, creditId, error: errorMessage(err) });
    return json(500, { error: 'Could not withdraw the credit' });
  }
}
