/**
 * The database side of marketing plans (LABEL-65). Pure rules live in
 * `marketing-plan.ts`. Everything here is the service role with an org filter
 * on every query; the routes decide who may call it.
 *
 * Migration 183 may not be applied: `planTablesReady` is a READ probe (a
 * PostgREST insert into a missing table answers an empty 404 that no helper
 * recognises), and `readPlanPhases` — used by the release gate — answers
 * `undefined` for "cannot be read", which the gate treats as "not asked".
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { PLAN_LIMITS, type AssetKind, type AssetStatus, type BudgetStatus, type PlanPhase, type Platform, type PlatformStep, type PlanViewInput } from './marketing-plan';

export const MIGRATION_183 = '183';
export const NEEDS_183 = 'Marketing plans need migration 183 applied on Supabase.';

export class MarketingNotReadyError extends Error {
  constructor() {
    super(NEEDS_183);
  }
}

type DbError = { message: string; code?: string } | null | undefined;
function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSchema(error)) throw new MarketingNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** Cheap read probe: is migration 183 there? */
export async function planTablesReady(admin: AdminClient): Promise<boolean> {
  const res = await admin.from('marketing_plans').select('id').limit(1);
  if (!res.error) return true;
  if (isMissingSchema(res.error)) return false;
  throw new Error(`marketing probe: ${res.error.message}`);
}

/** For the release gate: null = no plan, undefined = plans cannot be read. */
export async function readPlanPhases(admin: AdminClient, org: string, releaseId: string): Promise<{ phases: string[] } | null | undefined> {
  const plan = await admin.from('marketing_plans').select('id').eq('org_id', org).eq('release_id', releaseId).maybeSingle();
  if (plan.error) {
    if (isMissingSchema(plan.error)) return undefined;
    throw new Error(`marketing plan read: ${plan.error.message}`);
  }
  if (!plan.data) return null;
  const items = await admin.from('marketing_plan_items').select('phase').eq('org_id', org).eq('plan_id', (plan.data as { id: string }).id).limit(PLAN_LIMITS.items);
  if (items.error) {
    if (isMissingSchema(items.error)) return undefined;
    throw new Error(`marketing items read: ${items.error.message}`);
  }
  return { phases: ((items.data ?? []) as { phase: string }[]).map((i) => i.phase) };
}

export type PlanRow = { id: string; release_id: string; created_at: string; updated_at: string };
const PLAN_COLUMNS = 'id, release_id, created_at, updated_at';

export async function findPlan(admin: AdminClient, org: string, releaseId: string): Promise<PlanRow | null> {
  const res = await admin.from('marketing_plans').select(PLAN_COLUMNS).eq('org_id', org).eq('release_id', releaseId).maybeSingle();
  check('plan read', res.error);
  return (res.data as PlanRow | null) ?? null;
}

/** The release's plan, made on first write. Two writers racing both end up with the one row. */
export async function ensurePlan(admin: AdminClient, org: string, releaseId: string, userId: string): Promise<{ plan: PlanRow; created: boolean }> {
  const existing = await findPlan(admin, org, releaseId);
  if (existing) return { plan: existing, created: false };
  const ins = await admin.from('marketing_plans').insert({ org_id: org, release_id: releaseId, created_by: userId }).select(PLAN_COLUMNS).single();
  if (ins.error) {
    if (ins.error.code === '23505') {
      const again = await findPlan(admin, org, releaseId);
      if (again) return { plan: again, created: false };
    }
    check('plan create', ins.error);
  }
  return { plan: ins.data as PlanRow, created: true };
}

/** The plan's rows for the view. `withBudget` false reads no budget line at all. */
export async function loadPlanRows(admin: AdminClient, org: string, plan: PlanRow, withBudget: boolean): Promise<PlanViewInput> {
  const [items, steps, assets, budget] = await Promise.all([
    admin.from('marketing_plan_items').select('id, phase, title, due_on, done_at').eq('org_id', org).eq('plan_id', plan.id).order('due_on', { ascending: true }).order('id', { ascending: true }).limit(PLAN_LIMITS.items),
    admin.from('marketing_platform_steps').select('platform, step, done_at').eq('org_id', org).eq('plan_id', plan.id).limit(100),
    admin.from('marketing_asset_requests').select('id, kind, note, status, created_at, resolved_at, recipient_id').eq('org_id', org).eq('plan_id', plan.id).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(PLAN_LIMITS.assetRequests),
    withBudget
      ? admin.from('marketing_budget_lines').select('id, label, amount_minor, currency, status, note').eq('org_id', org).eq('plan_id', plan.id).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(PLAN_LIMITS.budgetLines)
      : Promise.resolve({ data: [], error: null }),
  ]);
  check('items read', items.error);
  check('steps read', steps.error);
  check('assets read', assets.error);
  check('budget read', budget.error);
  return {
    plan: { id: plan.id, releaseId: plan.release_id, createdAt: plan.created_at, updatedAt: plan.updated_at },
    items: (items.data ?? []) as PlanViewInput['items'],
    steps: (steps.data ?? []) as PlanViewInput['steps'],
    assets: (assets.data ?? []) as PlanViewInput['assets'],
    budget: (budget.data ?? []) as PlanViewInput['budget'],
  };
}

async function count(admin: AdminClient, table: string, org: string, planId: string): Promise<number> {
  const res = await admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', org).eq('plan_id', planId);
  check(`${table} count`, res.error);
  return res.count ?? 0;
}

export const touchPlan = async (admin: AdminClient, org: string, planId: string) => {
  const res = await admin.from('marketing_plans').update({ updated_at: new Date().toISOString() }).eq('org_id', org).eq('id', planId);
  check('plan touch', res.error);
};

// ── Timeline ─────────────────────────────────────────────────────────────

export type ItemRowOut = { id: string; phase: PlanPhase; title: string; due_on: string; done_at: string | null };
const ITEM_COLUMNS = 'id, phase, title, due_on, done_at';

export async function addItem(admin: AdminClient, org: string, plan: string, userId: string, body: { phase: PlanPhase; title: string; due_on: string }): Promise<ItemRowOut | 'full'> {
  if ((await count(admin, 'marketing_plan_items', org, plan)) >= PLAN_LIMITS.items) return 'full';
  const res = await admin.from('marketing_plan_items').insert({ org_id: org, plan_id: plan, created_by: userId, ...body }).select(ITEM_COLUMNS).single();
  check('item create', res.error);
  return res.data as ItemRowOut;
}

export async function patchItem(admin: AdminClient, org: string, plan: string, id: string, body: { phase?: PlanPhase; title?: string; due_on?: string; done?: boolean }): Promise<{ row: ItemRowOut; fields: string[] } | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: string[] = [];
  for (const k of ['phase', 'title', 'due_on'] as const) if (body[k] !== undefined) { patch[k] = body[k]; fields.push(k); }
  if (body.done !== undefined) {
    // Ticking an already-done milestone keeps its first completion time.
    const cur = body.done ? await admin.from('marketing_plan_items').select('done_at').eq('org_id', org).eq('plan_id', plan).eq('id', id).maybeSingle() : null;
    if (cur) check('item read', cur.error);
    const already = (cur?.data as { done_at: string | null } | null)?.done_at ?? null;
    if (!(body.done && already)) patch.done_at = body.done ? new Date().toISOString() : null;
    fields.push('done');
  }
  const res = await admin.from('marketing_plan_items').update(patch).eq('org_id', org).eq('plan_id', plan).eq('id', id).select(ITEM_COLUMNS).maybeSingle();
  check('item update', res.error);
  return res.data ? { row: res.data as ItemRowOut, fields } : null;
}

export async function removeItem(admin: AdminClient, org: string, plan: string, id: string): Promise<boolean> {
  const res = await admin.from('marketing_plan_items').delete().eq('org_id', org).eq('plan_id', plan).eq('id', id).select('id');
  check('item delete', res.error);
  return ((res.data ?? []) as unknown[]).length > 0;
}

// ── Platform checklist ───────────────────────────────────────────────────

export async function setStep(admin: AdminClient, org: string, plan: string, userId: string, b: { platform: Platform; step: PlatformStep; done: boolean }): Promise<void> {
  if (b.done) {
    const res = await admin.from('marketing_platform_steps').upsert({ org_id: org, plan_id: plan, platform: b.platform, step: b.step, done_by: userId }, { onConflict: 'plan_id,platform,step', ignoreDuplicates: true });
    check('step set', res.error);
  } else {
    const res = await admin.from('marketing_platform_steps').delete().eq('org_id', org).eq('plan_id', plan).eq('platform', b.platform).eq('step', b.step);
    check('step clear', res.error);
  }
}

// ── Budget ───────────────────────────────────────────────────────────────

export type BudgetRowOut = { id: string; label: string; amount_minor: number | string; currency: string; status: BudgetStatus; note: string | null };
const BUDGET_COLUMNS = 'id, label, amount_minor, currency, status, note';

export async function addBudget(admin: AdminClient, org: string, plan: string, userId: string, b: { label: string; amount_minor: string; currency: string; status?: BudgetStatus; note?: string | null }): Promise<BudgetRowOut | 'full'> {
  if ((await count(admin, 'marketing_budget_lines', org, plan)) >= PLAN_LIMITS.budgetLines) return 'full';
  const res = await admin.from('marketing_budget_lines').insert({ org_id: org, plan_id: plan, created_by: userId, label: b.label, amount_minor: b.amount_minor, currency: b.currency, status: b.status ?? 'planned', note: b.note ?? null }).select(BUDGET_COLUMNS).single();
  check('budget create', res.error);
  return res.data as BudgetRowOut;
}

export async function patchBudget(admin: AdminClient, org: string, plan: string, id: string, b: { label?: string; amount_minor?: string; currency?: string; status?: BudgetStatus; note?: string | null }): Promise<{ row: BudgetRowOut; fields: string[] } | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: string[] = [];
  for (const k of ['label', 'amount_minor', 'currency', 'status', 'note'] as const) if (b[k] !== undefined) { patch[k] = b[k]; fields.push(k); }
  const res = await admin.from('marketing_budget_lines').update(patch).eq('org_id', org).eq('plan_id', plan).eq('id', id).select(BUDGET_COLUMNS).maybeSingle();
  check('budget update', res.error);
  return res.data ? { row: res.data as BudgetRowOut, fields } : null;
}

export async function removeBudget(admin: AdminClient, org: string, plan: string, id: string): Promise<boolean> {
  const res = await admin.from('marketing_budget_lines').delete().eq('org_id', org).eq('plan_id', plan).eq('id', id).select('id');
  check('budget delete', res.error);
  return ((res.data ?? []) as unknown[]).length > 0;
}

// ── Asset requests ───────────────────────────────────────────────────────

export type AssetRowOut = { id: string; kind: AssetKind; note: string | null; status: AssetStatus; created_at: string; resolved_at: string | null; recipient_id: string | null };
const ASSET_COLUMNS = 'id, kind, note, status, created_at, resolved_at, recipient_id';

export async function addAssetRequest(admin: AdminClient, org: string, plan: string, userId: string, b: { kind: AssetKind; note?: string | null; recipientId: string | null }): Promise<AssetRowOut | 'full'> {
  if ((await count(admin, 'marketing_asset_requests', org, plan)) >= PLAN_LIMITS.assetRequests) return 'full';
  const res = await admin.from('marketing_asset_requests').insert({ org_id: org, plan_id: plan, requested_by: userId, kind: b.kind, note: b.note ?? null, recipient_id: b.recipientId, status: 'open' }).select(ASSET_COLUMNS).single();
  check('asset request create', res.error);
  return res.data as AssetRowOut;
}

/** Who the ask reached, written after it was sent (the row exists first). */
export async function setAssetRecipient(admin: AdminClient, org: string, plan: string, id: string, recipientId: string): Promise<void> {
  const res = await admin.from('marketing_asset_requests').update({ recipient_id: recipientId }).eq('org_id', org).eq('plan_id', plan).eq('id', id);
  check('asset request recipient', res.error);
}

export async function setAssetStatus(admin: AdminClient, org: string, plan: string, id: string, status: AssetStatus): Promise<AssetRowOut | null> {
  const res = await admin
    .from('marketing_asset_requests')
    .update({ status, resolved_at: status === 'open' ? null : new Date().toISOString() })
    .eq('org_id', org)
    .eq('plan_id', plan)
    .eq('id', id)
    .select(ASSET_COLUMNS)
    .maybeSingle();
  check('asset request update', res.error);
  return (res.data as AssetRowOut | null) ?? null;
}

// ── Calendar ─────────────────────────────────────────────────────────────

/** The milestones for the calendar feed: titles and days of the plans on the given releases. Chunked, so a big catalogue never overruns a request line. */
export async function feedMilestones(admin: AdminClient, org: string, releases: readonly { id: string; title: string }[]): Promise<{ id: string; releaseId: string; phase: string; title: string; dueOn: string; doneAt: string | null }[]> {
  const out: { id: string; releaseId: string; phase: string; title: string; dueOn: string; doneAt: string | null }[] = [];
  const CHUNK = 15; // plans per read: at most 15 × PLAN_LIMITS.items rows, under PostgREST's 1000-row cut
  for (let i = 0; i < releases.length; i += CHUNK) {
    const plans = await admin.from('marketing_plans').select('id, release_id').eq('org_id', org).in('release_id', releases.slice(i, i + CHUNK).map((r) => r.id));
    if (plans.error) {
      if (isMissingSchema(plans.error)) return [];
      throw new Error(`feed plans read: ${plans.error.message}`);
    }
    const byPlan = new Map(((plans.data ?? []) as { id: string; release_id: string }[]).map((p) => [p.id, p.release_id]));
    if (byPlan.size === 0) continue;
    const items = await admin
      .from('marketing_plan_items')
      .select('id, plan_id, phase, title, due_on, done_at')
      .eq('org_id', org)
      .in('plan_id', [...byPlan.keys()])
      .order('due_on', { ascending: true })
      .order('id', { ascending: true })
      .limit(PLAN_LIMITS.items * CHUNK);
    if (items.error) {
      if (isMissingSchema(items.error)) return [];
      throw new Error(`feed items read: ${items.error.message}`);
    }
    for (const r of (items.data ?? []) as { id: string; plan_id: string; phase: string; title: string; due_on: string; done_at: string | null }[]) {
      out.push({ id: r.id, releaseId: byPlan.get(r.plan_id) as string, phase: r.phase, title: r.title, dueOn: r.due_on, doneAt: r.done_at });
    }
  }
  return out;
}
