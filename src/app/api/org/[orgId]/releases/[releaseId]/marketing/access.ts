/**
 * Who may touch a release's marketing plan (LABEL-65), shared by the
 * `…/releases/[releaseId]/marketing/**` routes. Not a route itself.
 *
 *  - The RELEASE: requireObjectAccess on `releases` with `catalog.read` (its
 *    artist scope comes through the release's project): another org's release,
 *    one outside the member's artists, an external project member or a missing
 *    id is 404.
 *  - The MODULE: an org not licensed for `marketing` (or whose owner switched it
 *    off) answers 404, like every module's routes.
 *  - WRITES (timeline, checklist, asset requests): `release.write` OR
 *    `release.approve.marketing`. BUDGET reads and writes also need
 *    `business.read.internal` and never a role-`artist` member.
 *  - Migration 183 missing: reads answer `{ schemaReady: false }`, writes 503
 *    naming it. The probe is a READ (an insert into a missing table answers an
 *    empty 404).
 */
import { NextResponse } from 'next/server';
import { orgHasModule, type ObjectAccessResult } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { recordEvent } from '@/lib/labelos/activity';
import { mayReadBudget, mayWriteBudget, mayWritePlan } from '@/lib/labelos/marketing-plan';
import { NEEDS_183, ensurePlan, findPlan, planTablesReady, touchPlan } from '@/lib/labelos/marketing-plan-store';
import { isUUID } from '@/lib/validate';

export const NO_STORE = { 'Cache-Control': 'no-store' };
export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export type Access = Extract<ObjectAccessResult, { ok: true }>;

export type ReleaseInfo = { id: string; title: string; state: string; contactId: string | null; projectId: string | null };
export type PlanContext = {
  access: Access;
  admin: AdminClient;
  orgId: string;
  release: ReleaseInfo;
  plan: { id: string; release_id: string; created_at: string; updated_at: string };
  /** Who acts and what the event is about: handlers call `recordEvent(ctx.admin, ctx.actor, verb, ctx.subject, …)` themselves (coverage.test reads the handler's own text). Ids and field names only. */
  actor: { orgId: string; userId: string };
  subject: { type: 'release'; id: string; releaseId: string; artistId: string | null; projectId: string | null };
  touch: () => Promise<void>;
};

async function readRelease(admin: AdminClient, org: string, id: string): Promise<ReleaseInfo | null> {
  const res = await admin.from('releases').select('id, title, state, contact_id, project_id').eq('org_id', org).eq('id', id).maybeSingle();
  if (res.error) throw new Error(`release read: ${res.error.message}`);
  const r = res.data as { id: string; title: string; state: string; contact_id: string | null; project_id: string | null } | null;
  return r ? { id: r.id, title: r.title, state: r.state, contactId: r.contact_id, projectId: r.project_id } : null;
}

/**
 * The release, as every route here first authorises it (`requireObjectAccess` on `releases`, `catalog.read`),
 * then: the module, and whether the tables exist.
 */
export async function planReadAccess(access: Access): Promise<{ ok: true; access: Access; ready: boolean } | { ok: false; res: NextResponse }> {
  if (!orgHasModule(access, 'marketing')) return { ok: false, res: json(404, { error: 'Not found' }) };
  return { ok: true, access, ready: await planTablesReady(access.admin) };
}

/**
 * Write access, with the plan made on first write when `create` (a PATCH or DELETE of a row that
 * cannot exist without a plan answers 404 instead). `budget` demands the business reader too.
 */
export async function planWriteContext(authorised: Access, opts: { create: boolean; budget?: boolean }): Promise<{ ok: true; ctx: PlanContext } | { ok: false; res: NextResponse }> {
  const read = await planReadAccess(authorised);
  if (!read.ok) return read;
  const { access } = read;
  if (opts.budget ? !mayWriteBudget(access.capabilities, access.role) : !mayWritePlan(access.capabilities)) return { ok: false, res: json(403, { error: 'Forbidden' }) };
  if (!read.ready) return { ok: false, res: json(503, { error: NEEDS_183 }) };

  const release = await readRelease(access.admin, access.orgId, access.object.id);
  if (!release) return { ok: false, res: json(404, { error: 'Not found' }) };
  if (release.state === 'cancelled') return { ok: false, res: json(409, { error: 'A cancelled release has no marketing plan to change.' }) };

  let plan;
  let created = false;
  if (opts.create) {
    const made = await ensurePlan(access.admin, access.orgId, release.id, access.userId);
    plan = made.plan;
    created = made.created;
  } else {
    plan = await findPlan(access.admin, access.orgId, release.id);
    if (!plan) return { ok: false, res: json(404, { error: 'Not found' }) };
  }
  const subject = { type: 'release' as const, id: release.id, releaseId: release.id, artistId: release.contactId, projectId: release.projectId };
  const actor = { orgId: access.orgId, userId: access.userId };
  if (created) await recordEvent(access.admin, actor, 'marketing_plan.created', subject, {});
  return { ok: true, ctx: { access, admin: access.admin, orgId: access.orgId, release, plan, actor, subject, touch: () => touchPlan(access.admin, access.orgId, plan.id) } };
}

/** A path id that is not a uuid is the same 404 as a missing row. */
export const badId = (id: string) => !isUUID(id);

export { mayReadBudget };
