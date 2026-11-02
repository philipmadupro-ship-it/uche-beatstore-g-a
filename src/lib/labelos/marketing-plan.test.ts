import type { Capability } from './capabilities';
import { describe, expect, it } from 'vitest';
import {
  ASSET_KINDS,
  PLAN_PHASES,
  PLATFORMS,
  PLATFORM_STEPS,
  REQUIRED_PHASES,
  budgetTotals,
  checklistView,
  isMarketingPlanRequired,
  mayReadBudget,
  mayReadPlan,
  mayWriteBudget,
  mayWritePlan,
  milestoneCalendarEvents,
  missingPhases,
  planGateBlockers,
  planView,
  timelineOrder,
} from './marketing-plan';

const caps = (...c: string[]) => new Set(c) as unknown as ReadonlySet<Capability>;

describe('the vocabulary', () => {
  it('has the four phases the brief names, in lifecycle order', () => {
    expect([...PLAN_PHASES]).toEqual(['pre_save', 'teaser', 'release', 'post']);
  });
  it('requires a teaser and a release-day milestone for the gate', () => {
    expect([...REQUIRED_PHASES]).toEqual(['teaser', 'release']);
  });
  it('has a fixed platform checklist with no free text', () => {
    expect(PLATFORMS.length).toBeGreaterThan(2);
    expect([...PLATFORM_STEPS]).toEqual(['pitch', 'profile', 'pre_save', 'assets']);
    expect([...ASSET_KINDS]).toEqual(['artwork', 'photos', 'bio', 'video', 'other']);
  });
});

describe('isMarketingPlanRequired', () => {
  it('is on only for the exact boolean true', () => {
    expect(isMarketingPlanRequired({ marketing_plan_required: true })).toBe(true);
    for (const v of [false, 'true', 1, null, undefined, [], {}]) expect(isMarketingPlanRequired({ marketing_plan_required: v })).toBe(false);
    for (const v of [null, undefined, 'x', 3, []]) expect(isMarketingPlanRequired(v)).toBe(false);
  });
});

describe('the gate rule', () => {
  it('lists the missing required phases in order', () => {
    expect(missingPhases([])).toEqual(['teaser', 'release']);
    expect(missingPhases([{ phase: 'teaser' }])).toEqual(['release']);
    expect(missingPhases([{ phase: 'release' }, { phase: 'teaser' }, { phase: 'post' }])).toEqual([]);
  });
  it('asks for nothing when no plan is required', () => {
    expect(planGateBlockers({ required: false, plan: null })).toEqual([]);
    expect(planGateBlockers({ required: false, plan: { phases: [] } })).toEqual([]);
  });
  it('asks for nothing when plans cannot be read at all (migration 183 missing)', () => {
    expect(planGateBlockers({ required: true, plan: undefined })).toEqual([]);
  });
  it('blocks a release with no plan, then one with an incomplete timeline', () => {
    expect(planGateBlockers({ required: true, plan: null }).map((b) => b.code)).toEqual(['no_plan']);
    expect(planGateBlockers({ required: true, plan: { phases: ['pre_save', 'teaser'] } }).map((b) => b.code)).toEqual(['plan_missing_release']);
    expect(planGateBlockers({ required: true, plan: { phases: ['release', 'teaser'] } })).toEqual([]);
  });
});

describe('who may do what', () => {
  it('reads a plan with catalog.read', () => {
    expect(mayReadPlan(caps('catalog.read'))).toBe(true);
    expect(mayReadPlan(caps())).toBe(false);
  });
  it('writes the plan with release.write or the marketing approval', () => {
    expect(mayWritePlan(caps('release.write'))).toBe(true);
    expect(mayWritePlan(caps('release.approve.marketing'))).toBe(true);
    expect(mayWritePlan(caps('catalog.read', 'tasks.write'))).toBe(false);
  });
  it('reads a budget only with business.read.internal and never as an artist', () => {
    expect(mayReadBudget(caps('business.read.internal'), 'member')).toBe(true);
    expect(mayReadBudget(caps('business.read.internal'), 'artist')).toBe(false);
    expect(mayReadBudget(caps('catalog.read'), 'member')).toBe(false);
  });
  it('writes a budget only when it may write the plan AND read the budget', () => {
    expect(mayWriteBudget(caps('release.write', 'business.read.internal'), 'member')).toBe(true);
    expect(mayWriteBudget(caps('release.write'), 'member')).toBe(false);
    expect(mayWriteBudget(caps('business.read.internal'), 'member')).toBe(false);
    expect(mayWriteBudget(caps('release.write', 'business.read.internal'), 'artist')).toBe(false);
  });
});

describe('budgetTotals', () => {
  it('adds in integer minor units per currency and never mixes currencies', () => {
    const t = budgetTotals([
      { amountMinor: '150000', currency: 'USD', status: 'planned' },
      { amountMinor: '25050', currency: 'USD', status: 'spent' },
      { amountMinor: '9007199254740993', currency: 'USD', status: 'committed' },
      { amountMinor: '5000', currency: 'JPY', status: 'planned' },
    ]);
    expect(t).toEqual([
      { currency: 'JPY', planned: '5000', committed: '0', spent: '0', total: '5000' },
      { currency: 'USD', planned: '150000', committed: '9007199254740993', spent: '25050', total: '9007199254916043' },
    ]);
  });
  it('is empty for no lines', () => expect(budgetTotals([])).toEqual([]));
});

describe('timeline and checklist', () => {
  it('orders by day, then phase, then id', () => {
    const o = timelineOrder([
      { id: 'b', phase: 'post', dueOn: '2026-12-02' },
      { id: 'a', phase: 'release', dueOn: '2026-12-02' },
      { id: 'c', phase: 'teaser', dueOn: '2026-11-20' },
    ]);
    expect(o.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
  it('lists every platform with every step, ticked or not', () => {
    const v = checklistView([{ platform: 'spotify', step: 'pitch', doneAt: '2026-11-01T00:00:00Z' }]);
    expect(v.map((p) => p.platform)).toEqual([...PLATFORMS]);
    expect(v[0].steps.map((s) => s.step)).toEqual([...PLATFORM_STEPS]);
    expect(v[0].steps[0]).toMatchObject({ step: 'pitch', done: true });
    expect(v[0].steps[1]).toMatchObject({ step: 'profile', done: false });
    expect(v[1].steps.every((s) => !s.done)).toBe(true);
  });
});

describe('the calendar', () => {
  it('has titles and dates only: no notes, no ids beyond the milestone', () => {
    const ev = milestoneCalendarEvents(
      [{ id: 'i1', phase: 'teaser', title: 'Snippet', dueOn: '2026-12-01', doneAt: null }],
      { id: 'r1', title: 'Night Shift' },
    );
    expect(ev).toEqual([{ id: 'i1', releaseId: 'r1', summary: 'Teaser: Snippet · Night Shift', dueOn: '2026-12-01' }]);
  });
});

describe('planView', () => {
  const base = {
    plan: { id: 'p', releaseId: 'r', createdAt: 'x', updatedAt: 'y' },
    items: [{ id: 'i', phase: 'release', title: 'Drop', due_on: '2026-12-05', done_at: null, internal_secret: 'x' }],
    steps: [],
    budget: [{ id: 'b', label: 'Ads', amount_minor: 100, currency: 'USD', status: 'planned', note: 'private note', created_by: 'u' }],
    assets: [{ id: 'a', kind: 'photos', note: 'press shots', status: 'open', created_at: 't', resolved_at: null, recipient_id: 'u1', requested_by: 'u2' }],
  } as const;

  it('shows the budget with a business reader, with a note', () => {
    const v = planView(base as never, { canWrite: true, canWriteBudget: true, canReadBudget: true });
    expect(v.budget?.lines[0]).toEqual({ id: 'b', label: 'Ads', amountMinor: '100', currency: 'USD', status: 'planned', note: 'private note' });
    expect(v.budget?.totals).toHaveLength(1);
  });
  it('leaves the budget key out entirely for anyone else, and leaks no row field', () => {
    const v = planView(base as never, { canWrite: false, canWriteBudget: false, canReadBudget: false });
    expect('budget' in v).toBe(false);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/private note|Ads|amount|internal_secret|created_by|recipient|requested_by|u1|u2/);
  });
  it('says whether an asset request reached anyone, never who', () => {
    const v = planView(base as never, { canWrite: true, canWriteBudget: false, canReadBudget: false });
    expect(v.assets[0]).toMatchObject({ id: 'a', kind: 'photos', notified: true });
  });
});
