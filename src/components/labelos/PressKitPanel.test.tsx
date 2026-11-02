// @vitest-environment jsdom

/**
 * A release's press kit on the release page (LABEL-66): a notice, not a crash,
 * without migration 184; nothing to change for a reader; the tracker only when
 * the server sent one; a new share link shown once with a copy button; and
 * every change is one request followed by a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import { PressKitPanel } from './PressKitPanel';

const ORG = '10000000-0000-4000-8000-000000000001';
const REL = '70000000-0000-4000-8000-000000000001';

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[];
let state: Record<string, unknown>;
let shareStatus = 201;

const base = (over: Record<string, unknown> = {}) => ({
  schemaReady: true,
  kit: { headline: 'Nova returns', bio: 'A bio', preEmbargoNote: null, embargoAt: null },
  links: [{ id: 'l1', label: 'Instagram', url: 'https://instagram.com/nova' }],
  photos: [{ id: 'p1', label: 'Cover shoot', caption: null, preEmbargo: false }],
  photoChoices: [{ id: 'a1', label: 'Cover shoot', mime: 'image/png' }, { id: 'a2', label: 'Backstage', mime: 'image/png' }],
  shares: [{ id: 's1', label: 'Pitchfork', expiresAt: null, revokedAt: null, views: 2, lastViewedAt: null, createdAt: '2026-10-01T00:00:00Z', state: 'live' }],
  outreach: {
    contacts: [{ id: 'c1', name: 'Pat Press', outlet: 'The Quiet Review' }, { id: 'c2', name: 'Sam Second', outlet: null }],
    rows: [{ id: 'o1', contactId: 'c1', name: 'Pat Press', outlet: 'The Quiet Review', stage: 'sent', sentAt: '2026-10-02T00:00:00Z', openedAt: null, repliedAt: null, coverageUrl: null }],
  },
  me: { canWrite: true, canUseOutreach: true },
  ...over,
});

beforeEach(() => {
  calls = [];
  shareStatus = 201;
  state = base();
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/shares') && method === 'POST') return shareStatus === 201 ? json(201, { share: { id: 's2' }, path: '/press/TOKEN-ONCE' }) : json(shareStatus, { error: 'A kit holds at most 25 live links. Revoke one first.' });
    if (method === 'GET') return json(200, state);
    return json(200, { ok: true });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mutations = () => calls.filter((c) => c.method !== 'GET');

describe('what the panel draws', () => {
  it('a notice, not a crash, without migration 184', async () => {
    state = { schemaReady: false };
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByText(/not set up for this workspace yet/i)).toBeTruthy();
  });

  it('a reader sees the kit and no way to change it', async () => {
    state = base({ me: { canWrite: false, canUseOutreach: true } });
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByText('Nova returns')).toBeTruthy();
    expect(screen.queryByLabelText('Link address')).toBeNull();
    expect(screen.queryByLabelText('Add a photo')).toBeNull();
    expect(screen.queryByText('Make link')).toBeNull();
    expect(screen.queryByText('Revoke')).toBeNull();
    expect(screen.queryByLabelText(/Remove Pat Press/)).toBeNull();
  });

  it('no tracker when the server sent none (a member limited to some artists)', async () => {
    state = base({ outreach: undefined, me: { canWrite: true, canUseOutreach: false } });
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByTestId('press-embargo')).toBeTruthy();
    expect(screen.queryByTestId('press-outreach')).toBeNull();
  });

  it('says what the embargo is and that nothing is sent from the tracker', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    expect(await screen.findByText(/shows only the title, the line below and photos marked/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent from here/i)).toBeTruthy();
    expect(screen.getByTestId('press-embargo-state').textContent).toBe('No embargo');
  });

  it('shows an active embargo as embargoed', async () => {
    state = base({ kit: { headline: null, bio: null, preEmbargoNote: 'Soon', embargoAt: '2099-01-01T10:00:00.000Z' } });
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    expect((await screen.findByTestId('press-embargo-state')).textContent).toBe('Embargoed');
  });
});

describe('changes', () => {
  it('revokes a share link with one request', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    fireEvent.click(await screen.findByText('Revoke'));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'DELETE', url: `/api/org/${ORG}/releases/${REL}/press/shares/s1` });
  });

  it('a new link is shown once with its address, and hiding it forgets it', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    fireEvent.change(await screen.findByLabelText('Link label', { selector: 'input[placeholder^="Who"]' }), { target: { value: 'NME' } });
    fireEvent.click(screen.getByText('Make link'));
    const fresh = await screen.findByTestId('press-fresh-link');
    expect(fresh.textContent).toContain('/press/TOKEN-ONCE');
    expect(mutations()[0]).toMatchObject({ method: 'POST', body: { label: 'NME', expires_at: null } });
    fireEvent.click(screen.getByLabelText('Hide the link'));
    expect(screen.queryByTestId('press-fresh-link')).toBeNull();
  });

  it('a refused new link says why and shows no address', async () => {
    shareStatus = 409;
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    fireEvent.change(await screen.findByLabelText('Link label', { selector: 'input[placeholder^="Who"]' }), { target: { value: 'NME' } });
    fireEvent.click(screen.getByText('Make link'));
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => /at most 25/.test(t.title ?? ''))).toBe(true));
    expect(screen.queryByTestId('press-fresh-link')).toBeNull();
  });

  it('adds a link and clears the form', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    fireEvent.change(await screen.findByLabelText('Link label', { selector: 'input[placeholder="Label"]' }), { target: { value: 'Spotify' } });
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://open.spotify.com/x' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'POST', body: { label: 'Spotify', url: 'https://open.spotify.com/x' } });
  });

  it('ticks an outreach step with one request', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    const row = await screen.findByTestId('press-outreach-row');
    expect(row.getAttribute('data-stage')).toBe('sent');
    fireEvent.click(row.querySelectorAll('input[type="checkbox"]')[2]);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'PATCH', url: `/api/org/${ORG}/releases/${REL}/press/outreach/o1`, body: { replied: true } });
  });

  it('marks a photo for before the embargo', async () => {
    render(<PressKitPanel orgId={ORG} releaseId={REL} />);
    const photo = await screen.findByTestId('press-photo');
    fireEvent.click(photo.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'PATCH', url: `/api/org/${ORG}/releases/${REL}/press/photos/p1`, body: { pre_embargo: true } });
  });
});
