// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlatformConsole } from './PlatformConsole';
import { MODULES } from '@/lib/labelos/entitlements';

vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const licensee = {
  id: 'o1', name: 'North Star', slug: 'north-star', face: 'label', createdAt: '2026-10-01', licensed: true,
  modules: ['contracts', 'export'], maxSeats: 5, maxArtists: null, setupDone: false, seatsUsed: 2, artists: 3, owners: 0,
  pendingOwnerInvites: [{ email: 'boss@north.test', expiresAt: '2026-10-20' }],
};
let calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;
let createAnswer: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  createAnswer = { status: 201, body: { org: { id: 'o2', name: 'Solo', slug: 'solo', face: 'independent' }, invitation: null } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/platform/licensees' && method === 'GET') return new Response(JSON.stringify({ licensees: [licensee] }));
    if (url === '/api/platform/licensees') return new Response(JSON.stringify(createAnswer.body), { status: createAnswer.status });
    return new Response(JSON.stringify({ entitlements: {}, emailSent: true, invitation: { id: 'i' } }), { status: url.endsWith('/invitations') ? 201 : 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlatformConsole', () => {
  it('lists licensees with their face, usage, modules and state', async () => {
    render(<PlatformConsole />);
    const card = (await screen.findByRole('heading', { name: 'North Star' })).closest('li')!;
    const c = within(card as HTMLElement);
    expect(c.getByText(/Label · \/o\/north-star/)).toBeTruthy();
    expect(c.getByText('2 of 5')).toBeTruthy();
    expect(c.getByText('3 · no limit')).toBeTruthy();
    expect(c.getByText('Contracts & legal, Data export')).toBeTruthy();
    expect(c.getByText('Not set up yet')).toBeTruthy();
    expect(c.getByText('No owner yet')).toBeTruthy();
    expect(c.getByText(/boss@north\.test/)).toBeTruthy();
  });

  it('creates an independent licensee: slug from the name, every module by default, no artist cap field', async () => {
    render(<PlatformConsole />);
    fireEvent.click(await screen.findByRole('radio', { name: /Independent/ }));
    expect(screen.queryByLabelText('Artists')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Solo Act' } });
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('solo-act');
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Owner’s email'), { target: { value: 'me@solo.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create licensee' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/platform/licensees')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Solo Act', slug: 'solo-act', face: 'independent', modules: [...MODULES], max_seats: 2, owner_email: 'me@solo.test',
    });
  });

  it('refuses a malformed cap before sending, and shows the server’s refusal', async () => {
    render(<PlatformConsole />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Night' } });
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: 'ten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create licensee' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Seats: A whole number/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '' } });
    createAnswer = { status: 409, body: { error: 'That address is taken. Choose another.' } };
    fireEvent.click(screen.getByRole('button', { name: 'Create licensee' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That address is taken. Choose another.'));
  });

  it('edits a licence (modules + caps) and invites an owner', async () => {
    render(<PlatformConsole />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit licence of North Star' }));
    const form = screen.getByRole('form', { name: 'Licence for North Star' });
    fireEvent.click(within(form).getByLabelText('Contracts & legal'));
    fireEvent.click(within(form).getByLabelText('Finance'));
    fireEvent.change(within(form).getByLabelText('Seats'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save licence' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({
      url: '/api/platform/licensees/o1', method: 'PATCH', body: { modules: ['export', 'finance'], max_seats: null, max_artists: null },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Invite the owner of North Star' }));
    fireEvent.change(screen.getByLabelText('Owner’s email for North Star'), { target: { value: 'boss2@north.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/platform/licensees/o1/invitations')).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/invitations'))!.body).toEqual({ email: 'boss2@north.test' });
  });
});
