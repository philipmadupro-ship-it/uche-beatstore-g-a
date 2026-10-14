/**
 * What the approval routes share (LABEL-30): who may reach which subject, and
 * where each gate stands for the viewer. Not a route itself; the rules are
 * `approvals.ts`, the reads `approvals-store.ts`.
 *
 *  - The SUBJECT: a song is reached with `requireObjectAccess` on `tracks`
 *    (`catalog.read`: another org's, a producer track, one outside the
 *    member's artists is 404; then D4's row rule, as the song view answers);
 *    a release likewise on `releases`. Never trusted from the body.
 *  - READING approvals needs `release.write` or one of the five
 *    `release.approve.<gate>` abilities, as migration 157's policy does —
 *    a note on a legal gate is not for marketing-less, rights-less roles. The
 *    check is this one function so the routes and the database agree.
 *  - External project members never get here: both routes begin with
 *    `requireOrgMember`, which answers "not a member" for them.
 */
import { NextResponse } from 'next/server';
import { requireObjectAccess, type OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import {
  GATES,
  GATE_LABEL,
  approvalChip,
  approvalIsStale,
  snapshotKey,
  changedParts,
  currentDecision,
  gateAppliesTo,
  gateCapability,
  gatesFor,
  isOwnerOrAdmin,
  mayRequest,
  type Actor,
  type ApprovalRow,
  type Gate,
  type SubjectKind,
} from './approvals';
import { approverCandidates, currentSnapshot, listApprovals, namesOf, readReleaseFacts, approvalView, type ApprovalView, type Subject } from './approvals-store';
import { readReadinessSong } from './legal-readiness-store';
import { memberMayReadSongRow } from './song-stage-store';

const NO_STORE = { 'Cache-Control': 'no-store' };
export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/** The abilities that let a member see approvals at all (the policy of migration 157). */
export function mayReadApprovals(caps: ReadonlySet<string>): boolean {
  return caps.has('release.write') || GATES.some((g) => caps.has(gateCapability(g)));
}

export type ResolvedSubject =
  | { ok: true; access: OrgAccessOk; subject: Subject; table: 'tracks' | 'releases'; title: string | null }
  | { ok: false; res: NextResponse };

/** Reach the subject exactly as opening it would, then require the right to see approvals. */
export async function resolveSubject(orgId: string, subject: Subject): Promise<ResolvedSubject> {
  const table = subject.kind === 'song' ? 'tracks' : 'releases';
  const access = await requireObjectAccess({ table, id: subject.id, cap: 'catalog.read', orgId });
  if (!access.ok) return access;
  if (!mayReadApprovals(access.capabilities)) return { ok: false, res: json(403, { error: 'Forbidden' }) };
  let title: string | null = null;
  if (subject.kind === 'song') {
    const song = await readReadinessSong(access.admin, access.orgId, subject.id);
    if (!song || song.type !== 'song' || !(await memberMayReadSongRow(access.admin, access.orgId, subject.id, access.capabilities))) {
      return { ok: false, res: json(404, { error: 'Not found' }) };
    }
    title = song.title;
  } else {
    const rel = await access.admin.from('releases').select('title').eq('id', subject.id).eq('org_id', access.orgId).maybeSingle();
    if (rel.error) throw new Error(`release read: ${rel.error.message}`);
    title = (rel.data as { title: string } | null)?.title ?? null;
  }
  return { ok: true, access, subject, table, title };
}

export const actorOf = (access: Pick<OrgAccessOk, 'userId' | 'role' | 'capabilities'>): Actor => ({
  id: access.userId,
  role: access.role,
  capabilities: access.capabilities,
});

export type GateState = {
  gate: Gate;
  label: string;
  status: 'none' | 'requested' | 'approved' | 'changes_requested';
  /** Approved, but what it covered has changed since. */
  stale: boolean;
  /** Which parts changed (songs / artwork / items / release), for the "what changed" line. */
  changed: string[];
  chip: { label: string; tone: string };
  /** The latest approved / changes requested row. */
  decision: ApprovalView | null;
  /** The request still waiting for an answer. */
  pending: ApprovalView | null;
  /** The viewer holds this gate's capability. */
  canDecide: boolean;
  /** The viewer asked for the open request themselves and is not owner/admin: they cannot approve it. */
  selfApprovalBlocked: boolean;
  canRequest: boolean;
  /** The viewer may also hand the person asked a task ("Send to legal", LABEL-31): `tasks.write`. */
  canTask: boolean;
  /** `snapshotKey` of what the gate covers right now, for a viewer who can decide it; sent back as `seen` when approving. */
  snapshotKey: string | null;
  /** Members who could be asked (only for a viewer who may ask). */
  approvers: { userId: string; name: string }[];
};

/**
 * Where each gate of the subject stands for this viewer. Staleness is
 * derived here, on every read, from the stored snapshot and the facts as they
 * are now — the stored rows never change.
 */
export async function gateStates(admin: AdminClient, access: OrgAccessOk, resolved: Extract<ResolvedSubject, { ok: true }>, rows?: ApprovalRow[]): Promise<GateState[]> {
  const { subject, table } = resolved;
  const org = access.orgId;
  const all = rows ?? (await listApprovals(admin, org, subject));
  const names = await namesOf(admin, org, all.flatMap((r) => [r.actor_id, r.approver_id]));
  const release = subject.kind === 'release' ? await readReleaseFacts(admin, org, subject.id) : null;
  const actor = actorOf(access);
  const out: GateState[] = [];
  for (const gate of gatesFor(subject.kind)) {
    const current = currentDecision(all.filter((r) => r.gate === gate));
    let stale = false;
    let changed: string[] = [];
    const canDecide = access.capabilities.has(gateCapability(gate));
    let key: string | null = null;
    if ((current.status === 'approved' && current.latest) || canDecide) {
      const now = await currentSnapshot(admin, org, subject, gate, release);
      if (canDecide) key = snapshotKey(now);
      if (current.status === 'approved' && current.latest) stale = approvalIsStale(current, now);
      if (stale && current.latest) changed = changedParts(current.latest.subject_snapshot, now);
    }
    const canRequest = mayRequest(actor, gate);
    out.push({
      gate,
      label: GATE_LABEL[gate],
      status: current.status,
      stale,
      changed,
      chip: approvalChip(current, stale),
      decision: current.decided ? approvalView(current.decided, names) : null,
      pending: current.pending ? approvalView(current.pending, names) : null,
      canDecide,
      snapshotKey: key,
      selfApprovalBlocked: !!current.pending && current.pending.actor_id === access.userId && !isOwnerOrAdmin(access.role),
      canRequest,
      canTask: access.capabilities.has('tasks.write'),
      approvers: canRequest ? await approverCandidates(admin, org, subject, gate, { table, id: subject.id }) : [],
    });
  }
  return out;
}

export const subjectOfQuery = (q: URLSearchParams): Subject | null | 'ambiguous' => {
  const song = q.get('song');
  const release = q.get('release');
  if (song && release) return 'ambiguous';
  if (song) return { kind: 'song', id: song.toLowerCase() };
  if (release) return { kind: 'release', id: release.toLowerCase() };
  return null;
};

export { gateAppliesTo };
export type { SubjectKind };
