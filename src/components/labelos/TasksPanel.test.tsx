// @vitest-environment jsdom

/**
 * Tasks inline on a song (LABEL-23): the member's own side of the tasks there,
 * a checkbox that ticks one off through the route, a one-line form that
 * creates one only for a member who may (`canCreate`), and nothing at all for
 * a roster artist with no tasks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import type { TaskView } from '@/lib/labelos/tasks';
import { TasksPanel } from './TasksPanel';

const SONG = '50000000-0000-4000-8000-000000000001';
const ME = '20000000-0000-4000-8000-000000000001';
const YOU = '20000000-0000-4000-8000-000000000002';

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: 't1', title: 'Clear the sample', notes: null, dueAt: null, doneAt: null,
  assignee: { id: YOU, name: 'Ada' }, createdBy: { id: ME, name: 'Sam' }, target: { kind: 'song', id: SONG }, createdAt: '2026-10-01T10:00:00Z',
  mine: false, canChange: true, canDelete: true, ...over,
});

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let tasks: TaskView[];
let canCreate: boolean;

function stubFetch(handlers: { post?: (body: Record<string, unknown>) => Response; patch?: (id: string, body: Record<string, unknown>) => Response } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/tasks/assignees')) return json(200, { members: [{ id: ME, name: 'Sam' }, { id: YOU, name: 'Ada' }] });
    if (method === 'GET') return json(200, { tasks, canCreate });
    if (method === 'POST') return handlers.post ? handlers.post(body) : json(201, { task: task({ id: 'new', title: body.title, assignee: body.assignee_id ? { id: body.assignee_id, name: 'Ada' } : null }) });
    if (method === 'PATCH') return handlers.patch ? handlers.patch(url.split('/').pop()!, body) : json(200, { task: task({ doneAt: body.done ? '2026-10-06T10:00:00Z' : null }) });
    if (method === 'DELETE') return json(200, { ok: true });
    return json(404, {});
  }));
}

beforeEach(() => {
  calls = [];
  tasks = [];
  canCreate = true;
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () => render(<TasksPanel orgId="o1" object={{ kind: 'song', id: SONG }} />);

describe('TasksPanel', () => {
  it('asks for the tasks on THIS object and lists them, open first', async () => {
    tasks = [task({ id: 'a' }), task({ id: 'b', title: 'Done thing', doneAt: '2026-10-05T00:00:00Z' })];
    stubFetch();
    open();
    expect(await screen.findByText('Clear the sample')).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: `/api/org/o1/tasks?kind=song&id=${SONG}`, method: 'GET' });
    expect(screen.getByTestId('task-b').getAttribute('data-done')).toBe('true');
    expect(screen.getAllByText('Ada')).toHaveLength(2);
  });

  it('ticking a task off PATCHes done and shows it done', async () => {
    tasks = [task()];
    stubFetch();
    open();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Complete “Clear the sample”/ }));
    await waitFor(() => expect(screen.getByTestId('task-t1').getAttribute('data-done')).toBe('true'));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/org/o1/tasks/t1', body: { done: true } });
  });

  it('a failed tick says so and changes nothing', async () => {
    tasks = [task()];
    stubFetch({ patch: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) });
    open();
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Forbidden'));
    expect(screen.getByTestId('task-t1').getAttribute('data-done')).toBe('false');
  });

  it('adds a task from the one-line form, naming this song and the assignee', async () => {
    stubFetch();
    open();
    fireEvent.click(await screen.findByTestId('tasks-panel-add'));
    fireEvent.change(await screen.findByLabelText('Task'), { target: { value: 'Send stems to mixing' } });
    fireEvent.click(screen.getByRole('button', { name: /Assign to/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ada' }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Send stems to mixing')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/org/o1/tasks');
    expect(post.body).toMatchObject({ title: 'Send stems to mixing', assignee_id: YOU, target: { kind: 'song', id: SONG } });
    expect(typeof (post.body as { due_at: unknown }).due_at).toBe('string');
    // The picker was asked for members who can reach THIS song.
    expect(calls.some((c) => c.url === `/api/org/o1/tasks/assignees?kind=song&id=${SONG}`)).toBe(true);
  });

  it('a refused create toasts the server\'s reason and keeps the form', async () => {
    stubFetch({ post: () => new Response(JSON.stringify({ error: 'That member cannot be given this task' }), { status: 400 }) });
    open();
    fireEvent.click(await screen.findByTestId('tasks-panel-add'));
    fireEvent.change(await screen.findByLabelText('Task'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('That member cannot be given this task'));
    expect((screen.getByLabelText('Task') as HTMLInputElement).value).toBe('x');
  });

  it('offers no form to a member who cannot create tasks, and renders nothing when there is nothing to show', async () => {
    canCreate = false;
    stubFetch();
    const { container } = open();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
    expect(screen.queryByTestId('tasks-panel-add')).toBeNull();
  });

  it('a roster artist handed a task still sees it (and can tick it) without the form', async () => {
    canCreate = false;
    tasks = [task({ mine: true, canDelete: false })];
    stubFetch();
    open();
    expect(await screen.findByText('Clear the sample')).toBeTruthy();
    expect(screen.queryByTestId('tasks-panel-add')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(false);
  });

  it('only a task the member may delete shows a remove button, and removing drops it', async () => {
    tasks = [task({ id: 'a' }), task({ id: 'b', title: 'Not mine to delete', canDelete: false })];
    stubFetch();
    open();
    await screen.findByText('Not mine to delete');
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Remove “Clear the sample”/ }));
    await waitFor(() => expect(screen.queryByText('Clear the sample')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/org/o1/tasks/a');
  });

  it('does not reload on every parent render (a fresh object literal each time)', async () => {
    stubFetch();
    const { rerender } = open();
    await waitFor(() => expect(calls.length).toBe(1));
    rerender(<TasksPanel orgId="o1" object={{ kind: 'song', id: SONG }} />);
    rerender(<TasksPanel orgId="o1" object={{ kind: 'song', id: SONG }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });
});
