// @vitest-environment jsdom

/**
 * The project members panel (LABEL-21): who from outside the org is on a
 * project, and the controls to invite, change and remove them. The role
 * choices and their one-line summaries are the §2.6 table; the routes are
 * the real boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { confirmToast, toast } = vi.hoisted(() => ({
  confirmToast: vi.fn(async (..._args: unknown[]) => true),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast }));

import { ProjectMembersPanel } from './ProjectMembersPanel';

const ORG = 'o1';
const PROJECT = 'p1';
const BASE = `/api/org/${ORG}/projects/${PROJECT}`;

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let list: { members: unknown[]; invitations: unknown[]; schemaReady?: boolean };
let respond: (call: Call) => Response | null;

const member = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', name: 'Producer X', email: 'x@local.test', role: 'contributor', allow_downloads: false,
  expires_at: null, live: true, summary: 'Listens, comments, uploads versions; downloads masters', ...over,
});

beforeEach(() => {
  calls = [];
  list = { members: [member()], invitations: [{ id: 'i1', email: 'new@local.test', role: 'viewer', allow_downloads: false, expires_at: '2099-01-01T00:00:00Z' }] };
  respond = () => null;
  confirmToast.mockClear();
  confirmToast.mockImplementation(async () => true);
  Object.values(toast).forEach((f) => f.mockClear());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const custom = respond(call);
      if (custom) return custom;
      if (call.method === 'GET') return new Response(JSON.stringify(list), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async () => {
  render(<ProjectMembersPanel orgId={ORG} orgName="Night Shift" projectId={PROJECT} />);
  await screen.findByTestId('project-member-u1');
};

describe('ProjectMembersPanel', () => {
  it('lists the members with what their role may do, and pending invitations with Revoke', async () => {
    await open();
    expect(calls[0]).toMatchObject({ url: `${BASE}/members`, method: 'GET' });
    expect(screen.getByRole('heading', { name: 'People outside Night Shift' })).toBeTruthy();
    expect(screen.getByText('Producer X')).toBeTruthy();
    expect(screen.getByTestId('project-member-u1').textContent).toContain('uploads versions; downloads masters');
    expect(screen.getByTestId('project-invitation-i1').textContent).toContain('new@local.test');
    expect(screen.getByTestId('project-invitation-i1').textContent).toContain('Invited as Viewer');
  });

  it('invites by email with the chosen role; refuses a bad address without a request', async () => {
    await open();
    const email = screen.getByLabelText('Email address') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    expect(toast.error).toHaveBeenCalledWith('Enter a valid email address');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    fireEvent.change(email, { target: { value: ' guest@local.test ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    // The default role is contributor; downloads do not apply (a contributor always may).
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: `${BASE}/members`,
      body: { email: 'guest@local.test', role: 'contributor', allow_downloads: false },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation sent'));
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('');
  });

  it('says so when the invitation was created but the email could not be sent', async () => {
    respond = (c) => (c.method === 'POST' ? new Response(JSON.stringify({ invitation: {}, emailSent: false }), { status: 201 }) : null);
    await open();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'guest@local.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows the route’s refusal', async () => {
    respond = (c) => (c.method === 'POST' ? new Response(JSON.stringify({ error: 'This address already has a pending invitation to this project.' }), { status: 409 }) : null);
    await open();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'guest@local.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This address already has a pending invitation to this project.'));
  });

  it('removes a member only after asking, and says what happens to their uploads', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Producer X' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(confirmToast.mock.calls[0]).toMatchObject([expect.stringContaining('Remove Producer X'), expect.stringContaining('credited to them'), { danger: true }]);
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`${BASE}/members/u1`);
  });

  it('declining the confirmation removes nobody', async () => {
    confirmToast.mockImplementation(async () => false);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Producer X' }));
    await waitFor(() => expect(confirmToast).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('revokes a pending invitation', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the invitation to new@local.test' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`${BASE}/invitations/i1`);
  });

  it('a downloads switch appears only for a viewer or commenter (a contributor always downloads)', async () => {
    list = { members: [member(), member({ user_id: 'u2', name: 'Guest', role: 'viewer' })], invitations: [] };
    render(<ProjectMembersPanel orgId={ORG} orgName="Night Shift" projectId={PROJECT} />);
    await screen.findByTestId('project-member-u2');
    expect(screen.getByTestId('project-member-u1').textContent).not.toContain('Downloads');
    const sw = screen.getByTestId('project-member-u2').querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: `${BASE}/members/u2`, body: { allow_downloads: true } });
  });

  it('renders nothing when migration 148 is not applied', async () => {
    list = { members: [], invitations: [], schemaReady: false };
    const { container } = render(<ProjectMembersPanel orgId={ORG} orgName="Night Shift" projectId={PROJECT} />);
    await waitFor(() => expect(calls.length).toBe(1));
    await waitFor(() => expect(container.querySelector('[data-testid="project-members"]')).toBeNull());
  });

  it('a failed load says so instead of an empty list', async () => {
    respond = () => new Response('{}', { status: 500 });
    render(<ProjectMembersPanel orgId={ORG} orgName="Night Shift" projectId={PROJECT} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load');
  });
});
