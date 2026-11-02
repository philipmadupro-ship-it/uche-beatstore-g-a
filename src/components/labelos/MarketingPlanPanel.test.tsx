// @vitest-environment jsdom

/**
 * A release's marketing plan on the release page (LABEL-65): nothing to write
 * for someone who may not, a budget only when the server sent one, a gate note
 * when the org asks for a plan, an honest line when no artist account could be
 * reached, and a notice (not a crash) when migration 183 is missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import { checklistView } from '@/lib/labelos/marketing-plan';
import { MarketingPlanPanel } from './MarketingPlanPanel';

const ORG = '10000000-0000-4000-8000-000000000001';
const REL = '70000000-0000-4000-8000-000000000001';

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[];
let state: Record<string, unknown>;
let assetDelivery: string;

const base = (over: Record<string, unknown> = {}) => ({
  schemaReady: true,
  required: false,
  plan: { id: 'p1', releaseId: REL, createdAt: 'x', updatedAt: 'y' },
  me: { canWrite: true, canWriteBudget: true, canSetRequired: false },
  gate: { requiredPhases: ['teaser', 'release'], missing: [] },
  items: [{ id: 'i1', phase: 'teaser', title: 'Snippet on socials', dueOn: '2026-12-01', doneAt: null }],
  checklist: checklistView([]),
  assets: [],
  ...over,
});

beforeEach(() => {
  calls = [];
  assetDelivery = 'notified';
  state = base();
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/tasks')) return json(200, { tasks: [], canCreate: false });
    if (url.endsWith('/assets') && method === 'POST') return json(201, { delivery: assetDelivery, request: { id: 'a1' } });
    if (method === 'GET') return json(200, state);
    return json(200, { ok: true });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mutations = () => calls.filter((c) => c.method !== 'GET' && !c.url.includes('/tasks'));

describe('what the panel draws', () => {
  it('a notice, not a crash, without migration 183', async () => {
    state = { schemaReady: false };
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByText(/not set up for this workspace yet/i)).toBeTruthy();
  });

  it('a reader sees the plan and no way to change it', async () => {
    state = base({ me: { canWrite: false, canWriteBudget: false, canSetRequired: false } });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByText('Snippet on socials')).toBeTruthy();
    expect(screen.queryByTestId('marketing-milestone-form')).toBeNull();
    expect(screen.queryByLabelText(/Remove “Snippet/)).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Complete “Snippet/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('marketing-budget')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('draws the budget only when the server sent one, in major units from integer minor units', async () => {
    state = base({ budget: { lines: [{ id: 'b1', label: 'Playlist pitching', amountMinor: '150050', currency: 'USD', status: 'planned', note: null }], totals: [{ currency: 'USD', planned: '150050', committed: '0', spent: '0', total: '150050' }] } });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByTestId('marketing-budget')).toBeTruthy();
    expect(screen.getByTestId('budget-amount-b1').textContent).toBe('1500.50 USD');
  });

  it('says what the gate still needs when the org asks for a plan', async () => {
    state = base({ required: true, gate: { requiredPhases: ['teaser', 'release'], missing: ['release'] } });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    expect((await screen.findByTestId('marketing-plan-gate-note')).textContent).toMatch(/Still needed: a release milestone/);
  });

  it('only the owner gets the requirement switch, and it asks the settings route', async () => {
    state = base({ me: { canWrite: true, canWriteBudget: true, canSetRequired: true } });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ url: `/api/org/${ORG}/settings/marketing-plan`, method: 'PUT', body: { required: true } });
  });
});

describe('what the panel sends', () => {
  it('adds a milestone with a phase, a title and a real date', async () => {
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    const form = await screen.findByTestId('marketing-milestone-form');
    const add = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Milestone'), { target: { value: 'Drop day' } });
    fireEvent.change(screen.getByLabelText('Milestone date'), { target: { value: '2026-12-05' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/marketing/items`, method: 'POST', body: { phase: 'teaser', title: 'Drop day', due_on: '2026-12-05' } });
  });

  it('ticks a platform step', async () => {
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    fireEvent.click(await screen.findByLabelText('Spotify: Editorial pitch'));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'PUT', body: { platform: 'spotify', step: 'pitch', done: true } });
  });

  it('turns typed money into whole minor units and refuses a malformed amount', async () => {
    state = base({ budget: { lines: [], totals: [] } });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    const form = await screen.findByTestId('marketing-budget-form');
    const add = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Budget line'), { target: { value: 'Ads' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.345' } });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1,250.5' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0].body).toEqual({ label: 'Ads', amount_minor: '125050', currency: 'USD', status: 'planned' });
  });
});

describe('what the artist sees (L3)', () => {
  const open = [{ id: 'a1', kind: 'photos', note: 'Press shots', status: 'open', createdAt: 'x', resolvedAt: null, notified: true }];
  it('an artist with open asks and no write access is told how to deliver them', async () => {
    state = base({ me: { canWrite: false, canWriteBudget: false, canSetRequired: false }, assets: open });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    expect((await screen.findByTestId('marketing-asset-howto')).textContent).toMatch(/reply to your A&R contact.*upload the files to the project/);
    expect(screen.queryByRole('button', { name: /^Ask$/ })).toBeNull();
  });
  it('nobody is told that when they can write, or when nothing is open', async () => {
    state = base({ assets: open });
    const { unmount } = render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    await screen.findByTestId('marketing-assets');
    expect(screen.queryByTestId('marketing-asset-howto')).toBeNull();
    unmount();
    state = base({ me: { canWrite: false, canWriteBudget: false, canSetRequired: false }, assets: [{ ...open[0], status: 'fulfilled' }] });
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    await screen.findByTestId('marketing-assets');
    expect(screen.queryByTestId('marketing-asset-howto')).toBeNull();
  });
});

describe('asking the artist', () => {
  it('says the artist has been told when an account was reached', async () => {
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));
    expect((await screen.findByTestId('marketing-asset-delivery')).textContent).toBe('The artist has been told.');
  });

  it('says plainly when nobody could be reached', async () => {
    assetDelivery = 'nobody_reachable';
    render(<MarketingPlanPanel orgId={ORG} releaseId={REL} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));
    expect((await screen.findByTestId('marketing-asset-delivery')).textContent).toMatch(/nobody was told/);
  });
});
