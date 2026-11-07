/**
 * Marketing plans (LABEL-65). Pure: the vocabulary, who may do what, the gate
 * rule, the totals and the view a caller is told. The database reads are
 * `marketing-plan-store.ts`; the routes are under
 * `/api/org/[orgId]/releases/[releaseId]/marketing`.
 *
 * Decisions (flagged in the PR):
 *  - A plan is per RELEASE (one row each). Tasks are LABEL-23's `tasks` with
 *    `release_id`; there is no task table here.
 *  - READ a plan: `catalog.read` + the release's artist scope. WRITE the
 *    timeline, checklist and asset requests: `release.write` OR
 *    `release.approve.marketing` (the marketing function holds the latter).
 *    BUDGET lines are business data: read AND write also need
 *    `business.read.internal`, and a role-`artist` member never sees them. For
 *    anyone who may not, the `budget` key is ABSENT from the view, not zeroed.
 *  - Money is integer minor units + ISO currency (`finance/money.ts`), carried
 *    as strings in JSON. Totals are per currency; currencies are never mixed.
 *  - The marketing GATE may require a plan (`organizations.settings
 *    .marketing_plan_required`, default off, only the exact boolean `true`
 *    turns it on). When on, the release needs a plan with at least one
 *    milestone in each of `REQUIRED_PHASES` (a teaser and the release-day
 *    item); the rule is derived on every read, never stored. When plans cannot
 *    be read (migration 183 not applied) the requirement is not applied, so a
 *    gate behaves exactly as before.
 */
import type { Capability } from './capabilities';
import { add, money, type Money } from './finance/money';

export const PLAN_PHASES = ['pre_save', 'teaser', 'release', 'post'] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];
export const PHASE_LABEL: Record<PlanPhase, string> = { pre_save: 'Pre-save', teaser: 'Teaser', release: 'Release', post: 'Post' };
export const isPhase = (v: unknown): v is PlanPhase => typeof v === 'string' && (PLAN_PHASES as readonly string[]).includes(v);

/** The milestones a plan needs before it satisfies a gate that asks for one. */
export const REQUIRED_PHASES: readonly PlanPhase[] = ['teaser', 'release'];

export const PLATFORMS = ['spotify', 'apple_music', 'youtube', 'tiktok', 'instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { spotify: 'Spotify', apple_music: 'Apple Music', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
export const PLATFORM_STEPS = ['pitch', 'profile', 'pre_save', 'assets'] as const;
export type PlatformStep = (typeof PLATFORM_STEPS)[number];
export const STEP_LABEL: Record<PlatformStep, string> = { pitch: 'Editorial pitch', profile: 'Profile updated', pre_save: 'Pre-save live', assets: 'Assets uploaded' };

export const BUDGET_STATUSES = ['planned', 'committed', 'spent'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const ASSET_KINDS = ['artwork', 'photos', 'bio', 'video', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABEL: Record<AssetKind, string> = { artwork: 'Artwork', photos: 'Photos', bio: 'Bio', video: 'Video', other: 'Something else' };
export const ASSET_STATUSES = ['open', 'fulfilled', 'cancelled'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Bounds that keep every read to one page. */
export const PLAN_LIMITS = { items: 60, budgetLines: 40, assetRequests: 40, title: 120, label: 120, budgetNote: 500, assetNote: 300 } as const;

// ── The gate ─────────────────────────────────────────────────────────────

/** Total over any stored settings value: only the exact boolean `true` requires a plan. */
export function isMarketingPlanRequired(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && !Array.isArray(settings) && (settings as Record<string, unknown>).marketing_plan_required === true;
}

export function missingPhases(items: readonly { phase: string }[]): PlanPhase[] {
  const have = new Set(items.map((i) => i.phase));
  return REQUIRED_PHASES.filter((p) => !have.has(p));
}

export type PlanGateBlocker = { code: string; message: string };

/**
 * `plan`: null = the release has none; undefined = plans cannot be read at all (not applied), in which
 * case the requirement is not applied either.
 */
export function planGateBlockers(input: { required: boolean; plan: { phases: readonly string[] } | null | undefined }): PlanGateBlocker[] {
  if (!input.required || input.plan === undefined) return [];
  if (input.plan === null) return [{ code: 'no_plan', message: 'The release has no marketing plan.' }];
  return missingPhases(input.plan.phases.map((phase) => ({ phase }))).map((p) => ({
    code: `plan_missing_${p}`,
    message: `The marketing plan has no ${PHASE_LABEL[p].toLowerCase()} milestone.`,
  }));
}

// ── Who may do what ──────────────────────────────────────────────────────

type Caps = ReadonlySet<Capability>;
export const mayReadPlan = (caps: Caps): boolean => caps.has('catalog.read');
export const mayWritePlan = (caps: Caps): boolean => caps.has('release.write') || caps.has('release.approve.marketing');
export const mayReadBudget = (caps: Caps, role: string): boolean => role !== 'artist' && caps.has('business.read.internal');
export const mayWriteBudget = (caps: Caps, role: string): boolean => mayWritePlan(caps) && mayReadBudget(caps, role);

// ── Totals ───────────────────────────────────────────────────────────────

export type BudgetTotal = { currency: string; planned: string; committed: string; spent: string; total: string };

export function budgetTotals(lines: readonly { amountMinor: string; currency: string; status: string }[]): BudgetTotal[] {
  const by = new Map<string, Record<BudgetStatus, Money>>();
  for (const l of lines) {
    if (!(BUDGET_STATUSES as readonly string[]).includes(l.status)) continue;
    const slot = by.get(l.currency) ?? { planned: money(0, l.currency), committed: money(0, l.currency), spent: money(0, l.currency) };
    const status = l.status as BudgetStatus;
    slot[status] = add(slot[status], money(BigInt(l.amountMinor), l.currency));
    by.set(l.currency, slot);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, s]) => ({
      currency,
      planned: s.planned.minor.toString(),
      committed: s.committed.minor.toString(),
      spent: s.spent.minor.toString(),
      total: add(add(s.planned, s.committed), s.spent).minor.toString(),
    }));
}

// ── Timeline, checklist, calendar ────────────────────────────────────────

export function timelineOrder<T extends { id: string; phase: string; dueOn: string }>(items: readonly T[]): T[] {
  const rank = (p: string) => (PLAN_PHASES as readonly string[]).indexOf(p);
  return [...items].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || rank(a.phase) - rank(b.phase) || a.id.localeCompare(b.id));
}

export function checklistView(steps: readonly { platform: string; step: string; doneAt: string | null }[]) {
  const done = new Map(steps.map((s) => [`${s.platform}:${s.step}`, s.doneAt]));
  return PLATFORMS.map((platform) => ({
    platform,
    label: PLATFORM_LABEL[platform],
    steps: PLATFORM_STEPS.map((step) => ({ step, label: STEP_LABEL[step], done: done.has(`${platform}:${step}`), doneAt: done.get(`${platform}:${step}`) ?? null })),
  }));
}

/** One calendar event per milestone: a summary line and a day. Nothing else leaves the plan. */
export function milestoneCalendarEvents(
  items: readonly { id: string; phase: string; title: string; dueOn: string; doneAt: string | null }[],
  release: { id: string; title: string },
) {
  return timelineOrder(items)
    .filter((i) => isPhase(i.phase))
    .map((i) => ({ id: i.id, releaseId: release.id, summary: `${PHASE_LABEL[i.phase as PlanPhase]}: ${i.title} · ${release.title}`, dueOn: i.dueOn }));
}

// ── The view ─────────────────────────────────────────────────────────────

type ItemRow = { id: string; phase: string; title: string; due_on: string; done_at: string | null };
type StepRow = { platform: string; step: string; done_at: string };
type BudgetRow = { id: string; label: string; amount_minor: number | string | bigint; currency: string; status: string; note: string | null };
type AssetRow = { id: string; kind: string; note: string | null; status: string; created_at: string; resolved_at: string | null; recipient_id: string | null };

export type PlanViewInput = {
  plan: { id: string; releaseId: string; createdAt: string; updatedAt: string };
  items: readonly ItemRow[];
  steps: readonly StepRow[];
  budget: readonly BudgetRow[];
  assets: readonly AssetRow[];
};
export type PlanViewer = { canWrite: boolean; canWriteBudget: boolean; canReadBudget: boolean };

export type PlanView = {
  plan: { id: string; releaseId: string; createdAt: string; updatedAt: string };
  items: { id: string; phase: string; title: string; dueOn: string; doneAt: string | null }[];
  checklist: ReturnType<typeof checklistView>;
  assets: { id: string; kind: string; note: string | null; status: string; createdAt: string; resolvedAt: string | null; notified: boolean }[];
  me: { canWrite: boolean; canWriteBudget: boolean };
  gate: { requiredPhases: PlanPhase[]; missing: PlanPhase[] };
  /** Absent — not zeroed — unless the viewer may read budgets. */
  budget?: PlanBudgetView;
};

/** Built field by field: a row is never spread into the answer. */
export function planView(input: PlanViewInput, viewer: PlanViewer): PlanView {
  const items = timelineOrder(input.items.map((i) => ({ id: i.id, phase: i.phase, title: i.title, dueOn: i.due_on, doneAt: i.done_at })));
  const view = {
    plan: { id: input.plan.id, releaseId: input.plan.releaseId, createdAt: input.plan.createdAt, updatedAt: input.plan.updatedAt },
    items,
    checklist: checklistView(input.steps.map((s) => ({ platform: s.platform, step: s.step, doneAt: s.done_at }))),
    // `notified` says whether the ask reached an account; who it reached is not told.
    assets: input.assets.map((a) => ({ id: a.id, kind: a.kind, note: a.note, status: a.status, createdAt: a.created_at, resolvedAt: a.resolved_at, notified: a.recipient_id !== null })),
    me: { canWrite: viewer.canWrite, canWriteBudget: viewer.canWriteBudget },
    gate: { requiredPhases: [...REQUIRED_PHASES], missing: missingPhases(items) },
  };
  if (!viewer.canReadBudget) return view;
  const lines = input.budget.map((b) => ({ id: b.id, label: b.label, amountMinor: BigInt(b.amount_minor).toString(), currency: b.currency, status: b.status, note: b.note }));
  return { ...view, budget: { lines, totals: budgetTotals(lines) } };
}
export type PlanBudgetView = { lines: { id: string; label: string; amountMinor: string; currency: string; status: string; note: string | null }[]; totals: BudgetTotal[] };
