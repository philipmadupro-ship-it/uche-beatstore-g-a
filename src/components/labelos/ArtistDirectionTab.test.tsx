// @vitest-environment jsdom

/**
 * The Direction tab (LABEL-26): structured fields that save when left, a
 * keyword row, a reference list with one-click add, and — for a member who
 * cannot read internal references — no way to even ask for a team-only one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import type { ReferenceView } from '@/lib/labelos/direction';
import type { DirectionPayload } from '@/lib/labelos/direction-client';
import { ArtistDirectionTab } from './ArtistDirectionTab';

const ORG = '10000000-0000-4000-8000-000000000001';
const C1 = '30000000-0000-4000-8000-0000000000c1';

const ref = (over: Partial<ReferenceView> = {}): ReferenceView => ({
  id: 'r1', kind: 'note', title: 'Late night drives', note: 'Warm and close', url: null, host: null, trackId: null, trackTitle: null,
  assetId: null, file: null, visibility: 'artist', position: 0, createdAt: '2026-10-01', ...over,
});

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[];
let payload: DirectionPayload;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/references/choices')) return json(200, url.includes('kind=track') ? { tracks: [{ id: 't9', title: 'Midnight', type: 'song' }] } : { files: [] });
    if (url.endsWith('/direction') && method === 'GET') return json(200, payload);
    if (url.endsWith('/direction') && method === 'PUT') return json(200, { direction: body!.direction, updatedAt: '2026-10-02' });
    if (url.endsWith('/references') && method === 'POST') return json(201, { reference: ref({ id: 'new', kind: body!.kind as 'link', title: String(body!.title ?? 'x'), note: null, url: String(body!.url ?? ''), host: 'open.spotify.com', visibility: body!.visibility as 'artist' }) });
    if (method === 'DELETE') return json(200, { ok: true });
    return json(404, {});
  }));
}

beforeEach(() => {
  calls = [];
  payload = { schemaReady: true, direction: { sound: 'Dusty drums' }, updatedAt: null, references: [ref()], restrictedReferences: 0, permissions: { write: true, internal: true } };
  useToastStore.setState({ toasts: [] });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArtistDirectionTab', () => {
  it('shows the saved fields and references', async () => {
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    expect(await screen.findByTestId('dir-sound')).toHaveProperty('value', 'Dusty drums');
    expect(screen.getByText('Late night drives')).toBeTruthy();
  });

  it('a field saves the whole document when it is left, and not when nothing changed', async () => {
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    const sound = await screen.findByTestId('dir-sound');
    fireEvent.blur(sound);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    fireEvent.change(sound, { target: { value: 'Dusty drums, tape hiss' } });
    fireEvent.blur(sound);
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ direction: { sound: 'Dusty drums, tape hiss' } });
  });

  it('Escape puts the saved text back without saving', async () => {
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    const sound = await screen.findByTestId('dir-sound');
    fireEvent.change(sound, { target: { value: 'oops' } });
    fireEvent.keyDown(sound, { key: 'Escape' });
    expect((await screen.findByTestId('dir-sound') as HTMLTextAreaElement).value).toBe('Dusty drums');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('Enter adds a keyword', async () => {
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    const input = await screen.findByLabelText('Add a keyword');
    fireEvent.change(input, { target: { value: 'Soul' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ direction: { sound: 'Dusty drums', keywords: ['Soul'] } }));
  });

  it('adds a link and offers the team-only choice', async () => {
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    fireEvent.click(await screen.findByTestId('direction-add-open'));
    fireEvent.change(screen.getByTestId('direction-add-url'), { target: { value: 'https://open.spotify.com/x' } });
    fireEvent.change(screen.getByTestId('direction-add-title'), { target: { value: 'Playlist' } });
    fireEvent.click(screen.getByTestId('direction-add-internal'));
    fireEvent.click(screen.getByTestId('direction-add-submit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ kind: 'link', visibility: 'internal', title: 'Playlist', url: 'https://open.spotify.com/x' });
    expect(await screen.findByText('Playlist')).toBeTruthy();
  });

  it('a member who cannot read internal references is never offered the team-only choice', async () => {
    payload = { ...payload, permissions: { write: true, internal: false } };
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    fireEvent.click(await screen.findByTestId('direction-add-open'));
    expect(screen.queryByTestId('direction-add-internal')).toBeNull();
  });

  it('a read-only member sees text, no inputs and no add control; restricted references are counted', async () => {
    payload = { ...payload, restrictedReferences: 2, permissions: { write: false, internal: false } };
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    expect((await screen.findByTestId('dir-sound')).tagName).toBe('P');
    expect(screen.queryByTestId('direction-add-open')).toBeNull();
    expect(screen.queryByLabelText('Add a keyword')).toBeNull();
    expect(screen.getByTestId('direction-restricted').textContent).toContain('2 references');
  });

  it('marks a team-only reference', async () => {
    payload = { ...payload, references: [ref({ visibility: 'internal' })] };
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    expect(await screen.findByTestId('direction-ref-internal')).toBeTruthy();
  });

  it('says so before migration 152', async () => {
    payload = { ...payload, schemaReady: false };
    render(<ArtistDirectionTab orgId={ORG} contactId={C1} />);
    expect(await screen.findByText(/migration 152/)).toBeTruthy();
  });
});
