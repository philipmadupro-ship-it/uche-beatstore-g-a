/**
 * Approvals at a release gate (LABEL-30, 09 §2–3). Append-only: a request and
 * a decision are each a new row of `approvals` (migration 157), never an edit.
 *
 *  GET   ?song=<id> | ?release=<id> — where each gate of the subject stands for
 *        the caller: the latest decision with its note, the open request, the
 *        approvers who could be asked, and `stale` when what was approved has
 *        changed since (derived on this read from the stored snapshot).
 *  POST  — ask ONE member to decide a gate. Body { subject: { kind, id }, gate,
 *        approver_id, note? }.
 *
 * Who: reading needs `release.write` or a `release.approve.<gate>` ability;
 * asking needs `release.write`, `rights.write` or the gate's own capability,
 * and the person asked must hold `release.approve.<gate>` and reach the
 * subject themselves (membership, artist scope). A member cannot ask
 * themselves (nobody could answer); an owner or admin can. A song is asked for
 * `legal` only; the other four gates belong to a release. A request is allowed
 * while legal readiness has blockers — they are listed in the event.
 *
 * Both writes go through ONE Postgres function (`labelos_audit_approval_request`)
 * that inserts the row AND its `approval.requested` event in one transaction.
 * The person asked gets a direct-ask notification (lib/labelos/notify), best
 * effort, after the row exists.
 */
import { NextRequest } from 'next/server';
import { objectAccessFor, requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgApprovalRequestBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { gateCapability, currentDecision, planRequest } from '@/lib/labelos/approvals';
import { ApprovalsNotReadyError, approvalContext, currentSnapshot, isMissingApprovalsSchema, legalGateReadiness, listApprovals, readReleaseFacts } from '@/lib/labelos/approvals-store';
import { actorOf, gateStates, json, resolveSubject, subjectOfQuery } from '@/lib/labelos/approvals-route';
import { APPROVALS_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { CreditsNotReadyError } from '@/lib/labelos/credits-store';
import { LegalReadinessNotReadyError } from '@/lib/labelos/legal-readiness-store';
import { notifyDirectAsk } from '@/lib/labelos/notify';
import { SplitsNotReadyError } from '@/lib/labelos/splits-store';
import { askerName } from '@/lib/labelos/tasks-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.approvals');

type Params = { params: Promise<{ orgId: string }> };

const isNotReady = (err: unknown) =>
  err instanceof ApprovalsNotReadyError || err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError || err instanceof LegalReadinessNotReadyError;

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Approvals need Supabase.' });
  const member = await requireOrgMember(orgId);
  if (!member.ok) return member.res;

  const subject = subjectOfQuery(new URL(req.url).searchParams);
  if (!subject || subject === 'ambiguous') return json(400, { error: 'Name one subject: ?song=<id> or ?release=<id>' });

  try {
    const resolved = await resolveSubject(orgId, subject);
    if (!resolved.ok) return resolved.res;
    return json(200, { schemaReady: true, subject, title: resolved.title, gates: await gateStates(resolved.access.admin, resolved.access, resolved) });
  } catch (err) {
    if (isNotReady(err)) return json(200, { schemaReady: false, gates: [] });
    log.error('approval list failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the approvals' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Approvals need Supabase.' });
  const member = await requireOrgMember(orgId);
  if (!member.ok) return member.res;
  const parsed = await readBody(req, OrgApprovalRequestBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const subject = { kind: body.subject.kind, id: body.subject.id.toLowerCase() };
  const approverId = body.approver_id.toLowerCase();

  try {
    const resolved = await resolveSubject(orgId, subject);
    if (!resolved.ok) return resolved.res;
    const { access } = resolved;
    const { admin } = access;
    const org = access.orgId;

    const rows = await listApprovals(admin, org, subject);
    const current = currentDecision(rows.filter((r) => r.gate === body.gate));
    // The person asked must hold the gate's ability AND reach the subject themself: asking someone who cannot open it is a dead end.
    const approverAccess = await objectAccessFor(approverId, { table: resolved.table, id: subject.id, cap: gateCapability(body.gate), orgId: org });
    const plan = planRequest({
      kind: subject.kind,
      gate: body.gate,
      actor: actorOf(access),
      approverId,
      approverMayDecide: approverAccess.ok,
      current,
      note: body.note,
    });
    if (!plan.ok) return json(plan.status, { error: plan.error, code: plan.code });

    const release = subject.kind === 'release' ? await readReleaseFacts(admin, org, subject.id) : null;
    const snapshot = await currentSnapshot(admin, org, subject, body.gate, release);
    // Legal is asked even with blockers; the event lists them so the approver reads what is open.
    const readiness = body.gate === 'legal' ? await legalGateReadiness(admin, org, subject, release) : null;
    const ctx = await approvalContext(admin, org, subject, release);

    const { data, error } = await auditRpc(admin, 'approvalRequest', {
      p_org: org,
      p_actor: access.userId,
      p_kind: subject.kind,
      p_subject: subject.id,
      p_gate: body.gate,
      p_approver: approverId,
      p_note: body.note?.trim() || null,
      p_snapshot: snapshot as unknown as Record<string, unknown>,
      p_ctx: ctx,
      // Which gate and what was open; never the note's words, never a legal name.
      p_payload: { subject: subject.kind, approver_id: approverId, ...(readiness ? { blockers: readiness.blockers, blocker_codes: readiness.codes } : {}) },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingApprovalsSchema(error)) return json(503, { error: APPROVALS_NOT_READY });
      log.error('approval request failed', { orgId: org, gate: body.gate, error: error.message });
      return json(500, { error: 'Could not send the request' });
    }
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    if (data?.error === 'bad_gate') return json(400, { error: 'That gate does not apply here', code: 'bad_gate' });
    if (data?.error === 'already_requested') return json(409, { error: 'This is already waiting for an answer', code: 'already_requested' });
    if (data?.error === 'approver_not_member') return json(422, { error: 'That person cannot approve this gate', code: 'approver_cannot_decide' });

    const approval = data?.approval as { id: string } | undefined;
    // The ask: only the one person, only when somebody else (notifyDirectAsk skips yourself). Best effort.
    await notifyDirectAsk(admin, {
      kind: 'approval_requested',
      orgId: org,
      recipientId: approverId,
      actorId: access.userId,
      actorName: await askerName(admin, org, access.userId),
      subject: resolved.title,
      data: { approvalId: approval?.id ?? null, gate: body.gate, target: { kind: subject.kind, id: subject.id } },
    });

    return json(201, { schemaReady: true, subject, gates: await gateStates(admin, access, resolved) });
  } catch (err) {
    if (isNotReady(err)) return json(503, { error: APPROVALS_NOT_READY });
    log.error('approval request failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not send the request' });
  }
}
