/**
 * POST /api/org/[orgId]/approvals/decide — record "Approved" or "Changes
 * requested" at a gate (LABEL-30). Body { subject: { kind, id }, gate,
 * decision, note? }.
 *
 *  - Needs `release.approve.<gate>` (403 without it, before anything else
 *    about the gate is said). A requester cannot approve their own request
 *    unless they are owner or admin (D4 note). "Changes requested" needs a
 *    note. `legal` is recorded as approved only while the song's legal
 *    readiness has no BLOCKERS (`isReady`, never the percentage).
 *  - The row stores a snapshot of what the approver is approving
 *    (`subject_snapshot`: the split sheet versions in force and the credits for
 *    legal, the artwork file, the tracklist). It is never edited; if the
 *    facts move later the approval reads as stale (GET /approvals), derived.
 *  - `seen` (the `snapshotKey` the screen was drawn from) makes "Approved" mean "approved what I was looking at": it is
 *    REQUIRED to approve (400 `seen_required`), and when the facts changed since it is a 409 and nothing is written.
 *    The key reaches only a member who may decide the gate, through GET /approvals — which the subject's page loads — so
 *    having one is what "opened it" means; nothing else is stored for it (doc 21 #14).
 *  - Approving needs an open request addressed to the decider, owner/admin exempt (doc 21 #15). A SONG's legal gate cannot
 *    be approved once the song is on a release: the release's gate is the authority (doc 21 #13).
 *  - ONE Postgres function (`labelos_audit_approval_decide`) inserts the row and
 *    its `approval.decided` event in one transaction and re-checks the
 *    self-approval rule against the latest row under a lock, so two people
 *    deciding at once cannot slip past it. There is no update or delete route:
 *    the table has no such privilege either.
 */
import { NextRequest } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgApprovalDecideBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { approvalIsStale, currentDecision, isOwnerOrAdmin, planDecide, snapshotKey } from '@/lib/labelos/approvals';
import { ApprovalsNotReadyError, approvalContext, currentSnapshot, isMissingApprovalsSchema, legalGateReadiness, listApprovals, readReleaseFacts, releasesOfSong } from '@/lib/labelos/approvals-store';
import { actorOf, gateStates, json, resolveSubject } from '@/lib/labelos/approvals-route';
import { APPROVALS_NOT_READY, auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { CreditsNotReadyError } from '@/lib/labelos/credits-store';
import { LegalReadinessNotReadyError } from '@/lib/labelos/legal-readiness-store';
import { SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.approvals.decide');

type Params = { params: Promise<{ orgId: string }> };

const isNotReady = (err: unknown) =>
  err instanceof ApprovalsNotReadyError || err instanceof CreditsNotReadyError || err instanceof SplitsNotReadyError || err instanceof LegalReadinessNotReadyError;

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Approvals need Supabase.' });
  const member = await requireOrgMember(orgId);
  if (!member.ok) return member.res;
  const parsed = await readBody(req, OrgApprovalDecideBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const subject = { kind: body.subject.kind, id: body.subject.id.toLowerCase() };

  try {
    const resolved = await resolveSubject(orgId, subject);
    if (!resolved.ok) return resolved.res;
    const { access } = resolved;
    const { admin } = access;
    const org = access.orgId;

    const rows = await listApprovals(admin, org, subject);
    const current = currentDecision(rows.filter((r) => r.gate === body.gate));
    const release = subject.kind === 'release' ? await readReleaseFacts(admin, org, subject.id) : null;
    // What the approver is approving, as of now; also what an earlier approval is compared with.
    const snapshot = await currentSnapshot(admin, org, subject, body.gate, release);
    const readiness = body.gate === 'legal' && body.decision === 'approved' && access.capabilities.has('release.approve.legal')
      ? await legalGateReadiness(admin, org, subject, release)
      : null;

    const plan = planDecide({
      kind: subject.kind,
      gate: body.gate,
      decision: body.decision,
      note: body.note,
      actor: actorOf(access),
      current,
      stale: approvalIsStale(current, snapshot),
      legalReady: readiness?.ready,
      legalBlockers: readiness?.blockers,
      seen: body.seen,
      currentKey: snapshotKey(snapshot),
      songOnRelease: subject.kind === 'song' && body.gate === 'legal' && body.decision === 'approved' ? (await releasesOfSong(admin, org, subject.id)).length > 0 : false,
    });
    if (!plan.ok) return json(plan.status, { error: plan.error, code: plan.code });

    const ctx = await approvalContext(admin, org, subject, release);
    const { data, error } = await auditRpc(admin, 'approvalDecide', {
      p_org: org,
      p_actor: access.userId,
      p_kind: subject.kind,
      p_subject: subject.id,
      p_gate: plan.gate,
      p_decision: plan.decision,
      p_note: body.note?.trim() || null,
      p_snapshot: snapshot as unknown as Record<string, unknown>,
      p_may_self_approve: isOwnerOrAdmin(access.role),
      p_ctx: ctx,
      // The gate and the decision are added by the function; never the note's words.
      p_payload: { subject: subject.kind, answered_request: plan.requestId !== null, ...(readiness ? { blockers: readiness.blockers } : {}) },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingApprovalsSchema(error)) return json(503, { error: APPROVALS_NOT_READY });
      log.error('approval decision failed', { orgId: org, gate: body.gate, error: error.message });
      return json(500, { error: 'Could not record the decision' });
    }
    if (data?.error === 'not_found') return json(404, { error: 'Not found' });
    if (data?.error === 'self_approval') return json(403, { error: 'You cannot approve a request you made yourself', code: 'self_approval' });
    if (data?.error === 'note_required') return json(400, { error: 'Say what needs to change', code: 'note_required' });
    if (data?.error) return json(400, { error: 'That decision does not apply here', code: String(data.error) });

    return json(201, { schemaReady: true, subject, gates: await gateStates(admin, access, resolved) });
  } catch (err) {
    if (isNotReady(err)) return json(503, { error: APPROVALS_NOT_READY });
    log.error('approval decision failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not record the decision' });
  }
}
