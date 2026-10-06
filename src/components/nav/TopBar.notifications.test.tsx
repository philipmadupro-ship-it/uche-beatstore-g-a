// @vitest-environment jsdom

/**
 * The bell (LABEL-23): on the producer dashboard it is the producer's, exactly
 * as before (`/api/notifications` and the store-attention summary); under an
 * org it is THAT org's direct asks (`/api/org/<id>/notifications`) and makes
 * none of the producer-only requests — a member who is not the producer never
 * calls a producer route, and an unread ask opens the thing it is about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { capabilitiesFor, type Capability } from '@/lib/labelos/capabilities';
import { OrgShellProvider, type OrgShellValue } from '@/components/labelos/OrgShellContext';
import { TopBar } from './TopBar';

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/o/night-shift', useRouter: () => ({ push }) }));
vi.mock('@/hooks/useRealtimeTable', () => ({ useRealtimeTable: () => {} }));
vi.mock('@/components/activity/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('./SessionContextControl', () => ({ SessionContextControl: () => null }));
vi.mock('./OrgSwitcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/hooks/useBrandArtwork', () => ({ useBrandArtwork: () => ({ logoUrl: null }) }));

const SONG = '50000000-0000-4000-8000-000000000001';

const shell = (viewerIsProducer = false): OrgShellValue => ({
  org: { id: 'o1', name: 'Night Shift', slug: 'night-shift', kind: 'label' },
  role: 'member',
  scope: 'org',
  capabilities: [...capabilitiesFor('label', 'member', ['a_and_r'])] as Capability[],
  viewerIsProducer,
});

let urls: string[];
let orgRows: Record<string, unknown>[];

beforeEach(() => {
  urls = [];
  push.mockClear();
  orgRows = [{ id: 'n1', kind: 'task_assigned', title: 'Ada assigned you a task', body: 'Clear the sample', data: { taskId: 't1', target: { kind: 'song', id: SONG } }, read: false, created_at: new Date().toISOString() }];
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/org/o1/notifications') return json({ notifications: orgRows, unread: orgRows.length, hasMore: false });
    if (url === '/api/notifications') return json({ notifications: [{ id: 'p1', kind: 'purchase', title: 'New sale', body: null, read: false, created_at: new Date().toISOString() }], unread: 1, hasMore: false });
    if (url === '/api/tracks/store-summary') return json({ issues: { noCover: { count: 2 }, noPrice: { count: 0 }, noBpmKey: { count: 0 } } });
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bell = () => screen.getByRole('button', { name: /^Notifications/ });

describe('TopBar bell', () => {
  it('on the producer dashboard it is the producer\'s bell, unchanged', async () => {
    render(<TopBar />);
    await waitFor(() => expect(urls).toContain('GET /api/notifications'));
    expect(urls).toContain('GET /api/tracks/store-summary');
    expect(urls.some((u) => u.includes('/api/org/'))).toBe(false);
    fireEvent.click(bell());
    expect(await screen.findByText('New sale')).toBeTruthy();
    expect(screen.getByText(/Activity log/)).toBeTruthy();
    expect(screen.getByText(/2 beats need attention/)).toBeTruthy();
  });

  it('under an org it shows THAT org\'s asks and calls no producer route', async () => {
    render(<OrgShellProvider value={shell()}><TopBar /></OrgShellProvider>);
    await waitFor(() => expect(urls).toContain('GET /api/org/o1/notifications'));
    await new Promise((r) => setTimeout(r, 20));
    // A member who is not the producer: no producer notifications, no store attention, no search of the producer's…
    expect(urls.filter((u) => u.includes('/api/notifications'))).toEqual([]);
    expect(urls.filter((u) => u.includes('store-summary'))).toEqual([]);
    fireEvent.click(bell());
    expect(await screen.findByText('Ada assigned you a task')).toBeTruthy();
    expect(screen.getByText('Clear the sample')).toBeTruthy();
    // The producer's activity log is a producer route: not offered here.
    expect(screen.queryByText(/Activity log/)).toBeNull();
    expect(screen.queryByText(/need attention/)).toBeNull();
  });

  it('even a producer, inside an org, gets the org\'s bell there — not the dashboard\'s store attention', async () => {
    render(<OrgShellProvider value={shell(true)}><TopBar /></OrgShellProvider>);
    await waitFor(() => expect(urls).toContain('GET /api/org/o1/notifications'));
    await new Promise((r) => setTimeout(r, 20));
    expect(urls.filter((u) => u.includes('/api/notifications') || u.includes('store-summary'))).toEqual([]);
  });

  it('clicking an unread ask reads it through the org route and opens the song it is about', async () => {
    render(<OrgShellProvider value={shell()}><TopBar /></OrgShellProvider>);
    fireEvent.click(bell());
    fireEvent.click(await screen.findByRole('button', { name: /Open "Ada assigned you a task"/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/night-shift/songs/${SONG}`));
    expect(urls).toContain('PATCH /api/org/o1/notifications?action=read');
  });

  it('"Mark all read" goes to the org route too', async () => {
    render(<OrgShellProvider value={shell()}><TopBar /></OrgShellProvider>);
    fireEvent.click(bell());
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(urls).toContain('PATCH /api/org/o1/notifications?action=read_all');
  });

  it('with nothing asked of them, the panel says so', async () => {
    orgRows = [];
    render(<OrgShellProvider value={shell()}><TopBar /></OrgShellProvider>);
    await waitFor(() => expect(urls).toContain('GET /api/org/o1/notifications'));
    fireEvent.click(bell());
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
  });
});
