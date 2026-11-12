// @vitest-environment jsdom

/**
 * "My work" (LABEL-23): what is assigned to me grouped by due date with links
 * to the object, "Waiting on others", ticking off, and silence when there is
 * nothing — so an org with no tasks keeps the Overview exactly as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskView } from '@/lib/labelos/tasks';
import { MyWorkPanel } from './MyWorkPanel';

const SONG = '50000000-0000-4000-8000-000000000001';
const ME = '20000000-0000-4000-8000-000000000001';
const YOU = '20000000-0000-4000-8000-000000000002';
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(12, 0, 0, 0); return d.toISOString(); };

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: 't1', title: 'Clear the sample', notes: null, dueAt: null, doneAt: null,
  assignee: { id: ME, name: 'Me' }, createdBy: { id: YOU, name: 'Ada' }, target: { kind: 'song', id: SONG }, createdAt: '2026-10-01T10:00:00Z',
  mine: true, canChange: true, canDelete: false, ...over,
});

let mine: TaskView[];
let asked: TaskView[];
const calls: string[] = [];

beforeEach(() => {
  mine = [];
  asked = [];
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'PATCH') return json({ task: task({ doneAt: '2026-10-06T10:00:00Z' }) });
    return json({ tasks: url.includes('view=asked') ? asked : mine, canCreate: true });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MyWorkPanel', () => {
  it('renders nothing when there is nothing assigned and nothing waiting', async () => {
    const { container } = render(<MyWorkPanel orgId="o1" orgSlug="night-shift" />);
    await waitFor(() => expect(calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('section')).toBeNull();
  });

  it('groups what is assigned to me overdue → today → upcoming → no date, with a link to the song', async () => {
    mine = [
      task({ id: 'u', title: 'Mix revisions', dueAt: day(5) }),
      task({ id: 'o', title: 'Sample clearance', dueAt: day(-3) }),
      task({ id: 'n', title: 'Tidy the folder' }),
      task({ id: 't', title: 'Send the stems', dueAt: day(0) }),
    ];
    render(<MyWorkPanel orgId="o1" orgSlug="night-shift" />);
    await screen.findByText('Sample clearance');
    const order = ['my-work-overdue', 'my-work-today', 'my-work-upcoming', 'my-work-someday'].map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('my-work-count').textContent).toBe('4');
    const link = screen.getAllByRole('link', { name: 'Song' })[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/o/night-shift/songs/${SONG}`);
    expect(calls).toContain('GET /api/org/o1/tasks?view=mine');
    expect(calls).toContain('GET /api/org/o1/tasks?view=asked');
  });

  it('shows "Waiting on others" separately, and ticking a task off removes it', async () => {
    mine = [task({ id: 'm', title: 'Mine' })];
    asked = [task({ id: 'a', title: 'Handed over', assignee: { id: YOU, name: 'Ada' }, mine: false })];
    render(<MyWorkPanel orgId="o1" orgSlug="night-shift" />);
    await screen.findByText('Mine');
    expect(screen.getByTestId('waiting-on-others').textContent).toContain('Handed over');
    fireEvent.click(screen.getByRole('checkbox', { name: /Complete “Mine”/ }));
    await waitFor(() => expect(screen.queryByText('Mine')).toBeNull());
    expect(calls).toContain('PATCH /api/org/o1/tasks/m');
    // The task handed to someone else is still waiting.
    expect(screen.getByText('Handed over')).toBeTruthy();
  });

  it('only waiting tasks: says nothing is assigned to me but still shows what is waiting', async () => {
    asked = [task({ id: 'a', title: 'Handed over', assignee: { id: YOU, name: 'Ada' }, mine: false })];
    render(<MyWorkPanel orgId="o1" orgSlug="night-shift" />);
    expect(await screen.findByText('Nothing is assigned to you.')).toBeTruthy();
    expect(screen.getByText('Handed over')).toBeTruthy();
  });
});
