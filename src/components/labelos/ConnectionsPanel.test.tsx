// @vitest-environment jsdom

/**
 * The connections panel (LABEL-41): a label and an artist org see different
 * things of the same connection. The artist decides what is shared; a label
 * only opens the shared music; a request can be accepted only by the side
 * that did not ask. The routes re-check all of it; this only offers it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectionView } from '@/lib/labelos/connections';
import { ConnectionsPanel } from './ConnectionsPanel';

const view = (over: Partial<ConnectionView> = {}): ConnectionView => ({
  id: 'c1', status: 'active', side: 'artist', initiatedByMe: false, other: { name: 'Night Shift', slug: 'night-shift' },
  rosterContactId: null, shareMode: 'selected', allowCopies: false, projectIds: ['p1'], createdAt: '2026-10-01', acceptedAt: '2026-10-02', canAccept: false, ...over,
});

let connections: ConnectionView[];
const calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  connections = [];
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'POST' && url.endsWith('/connections')) return json({ requested: true }, 202);
    if (init?.method === 'POST' || init?.method === 'DELETE') return json({ ok: true });
    return json({ connections, projects: [{ id: 'p1', name: 'Nova demos' }, { id: 'p2', name: 'Private' }] });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectionsPanel', () => {
  it('says so when there are no connections, and asks by slug or email', async () => {
    render(<ConnectionsPanel orgId="o1" orgSlug="nova" orgKind="artist" />);
    await screen.findByText('No connections yet.');
    const input = screen.getByLabelText(/slug or an owner/i);
    fireEvent.change(input, { target: { value: 'night-shift' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to connect/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/org/o1/connections', body: { slug: 'night-shift' } });
    fireEvent.change(input, { target: { value: 'owner@label.test' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to connect/i }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ email: 'owner@label.test' });
  });

  it('an artist org sees what each label can reach and has the Sharing control; a label has the music link and no Sharing', async () => {
    connections = [view()];
    const artist = render(<ConnectionsPanel orgId="o1" orgSlug="nova" orgKind="artist" />);
    await screen.findByText('Night Shift');
    expect(screen.getByText(/Connected · 1 project/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sharing' })).toBeTruthy();
    expect(screen.queryByText('Open shared music')).toBeNull();
    artist.unmount();

    connections = [view({ side: 'label', other: { name: 'Nova', slug: 'nova' }, projectIds: null, initiatedByMe: true })];
    render(<ConnectionsPanel orgId="o2" orgSlug="night-shift" orgKind="label" />);
    await screen.findByText('Nova');
    expect((screen.getByText('Open shared music') as HTMLAnchorElement).getAttribute('href')).toBe('/o/night-shift/connections/c1');
    expect(screen.queryByRole('button', { name: 'Sharing' })).toBeNull();
  });

  it('only the side that did not ask is offered Accept', async () => {
    connections = [view({ status: 'requested', canAccept: true }), view({ id: 'c2', status: 'requested', initiatedByMe: true, other: { name: 'Other', slug: 'other' } })];
    render(<ConnectionsPanel orgId="o1" orgSlug="nova" orgKind="artist" />);
    await screen.findByText('Other');
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
    expect(screen.getByText('Request sent')).toBeTruthy();
    expect(screen.getByText('Wants to connect')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/org/o1/connections/c1/accept')).toBe(true));
  });

  it('shows the not-ready notice instead of an empty list before the migration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ connections: [], notReady: 'Artist ↔ label connections are not set up yet (migration 154 has not been applied).' }), { status: 200 })));
    render(<ConnectionsPanel orgId="o1" orgSlug="nova" orgKind="artist" />);
    expect((await screen.findByRole('alert')).textContent).toContain('migration 154');
  });
});
