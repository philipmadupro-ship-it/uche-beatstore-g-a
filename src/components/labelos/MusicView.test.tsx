// @vitest-environment jsdom

/**
 * The Music page's filter bar and list (LABEL-37): applied filters are chips
 * that remove one at a time, the URL is the memory, a saved view is applied by
 * id (never by pasting its definition), saving posts only the definition, and a
 * viewer whose role cannot use a clause is told why the list is empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MusicView } from './MusicView';
import { OrgShellProvider, type OrgShellValue } from './OrgShellContext';
import { decodeDefinition, encodeDefinition, type Definition } from '@/lib/labelos/filters';

vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, confirmToast: vi.fn(async () => true) }));

const ORG = '10000000-0000-4000-8000-000000000001';
const NOVA = '30000000-0000-4000-8000-0000000000c1';
const VIEW = '60000000-0000-4000-8000-000000000001';

const shell = (caps: string[]): OrgShellValue => ({
  org: { id: ORG, name: 'Night Shift', slug: 'ns', kind: 'label' },
  role: 'member',
  scope: 'org',
  capabilities: caps as OrgShellValue['capabilities'],
  viewerIsProducer: false,
});

const song = (id: string, title: string) => ({ id, title, stage: 'inbox', coverUrl: null, bpm: 120, key: 'F minor', createdAt: '2026-10-01T10:00:00Z', released: false, artist: { id: NOVA, name: 'Nova' }, project: { id: 'p', name: 'Nova EP' } });

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let runs: Array<(url: URL) => unknown>;
let views: unknown[];

function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://app.test');
    const method = init?.method ?? 'GET';
    calls.push({ url: url.pathname + url.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.pathname.endsWith('/views/run')) return ok((runs.shift() ?? (() => ({})))(url));
    if (url.pathname.endsWith('/views') && method === 'GET') return ok({ schemaReady: true, views, names: { artists: { [NOVA]: 'Nova' }, parties: {}, projects: {} }, canShare: true });
    if (url.pathname.endsWith('/views') && method === 'POST') {
      const body = JSON.parse(String(init!.body));
      views = [{ id: VIEW, subject: 'songs', name: body.name, shared: body.shared, mine: true, author: null, definition: body.definition, narrowed: false, canEdit: true, canDelete: true, canUnshare: false, updatedAt: 'x' }];
      return ok({ view: views[0], names: { artists: {}, parties: {}, projects: {} } }, 201);
    }
    if (url.pathname.endsWith('/contacts')) return ok({ contacts: [{ id: NOVA, name: 'Nova' }] });
    if (url.pathname.endsWith('/parties')) return ok({ parties: [{ id: '80000000-0000-4000-8000-000000000001', display_name: 'Producer X' }] });
    return ok({}, 404);
  }));
}

const runBody = (def: Definition, rows: unknown[], extra: Record<string, unknown> = {}) => ({
  result: { kind: 'songs', rows, total: rows.length, more: false, unavailable: [], ...extra },
  definition: def,
  narrowed: false,
  names: { artists: { [NOVA]: 'Nova' }, parties: {}, projects: {} },
  view: null,
});
const EMPTY: Definition = { v: 1, subject: 'songs', filter: {} };
const mount = (caps = ['catalog.read']) => render(<OrgShellProvider value={shell(caps)}><MusicView /></OrgShellProvider>);
const runCalls = () => calls.filter((c) => c.url.includes('/views/run'));

beforeEach(() => {
  views = [];
  runs = [];
  window.history.replaceState(null, '', '/o/ns/music');
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the list', () => {
  it('shows the songs the server returned, with where each one is', async () => {
    runs.push(() => runBody(EMPTY, [song('s1', 'Home'), song('s2', 'Away')]));
    mount();
    expect(await screen.findByTestId('music-row-s1')).toBeTruthy();
    expect(within(screen.getByTestId('music-row-s1')).getByRole('link').getAttribute('href')).toBe('/o/ns/songs/s1');
    expect(screen.getByTestId('music-count').textContent).toMatch(/2 songs/);
    expect(screen.getByTestId('music-row-s1').textContent).toMatch(/Nova · Nova EP/);
  });

  it('says why nothing shows when the role cannot use a clause, and never lists rows', async () => {
    const def: Definition = { v: 1, subject: 'songs', filter: { splits: 'incomplete' } };
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, [], { unavailable: ['splits'] }));
    mount();
    expect(await screen.findByText('Your role cannot use this filter')).toBeTruthy();
    expect(screen.queryByTestId('music-count')).toBeNull();
  });

  it('a filter that matches nothing says so, and an empty org says that instead', async () => {
    const def: Definition = { v: 1, subject: 'songs', filter: { stages: ['selected'] } };
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, []));
    mount();
    expect(await screen.findByText('No songs match')).toBeTruthy();
  });
});

describe('chips and the URL', () => {
  const def: Definition = { v: 1, subject: 'songs', filter: { stages: ['inbox'], artistIds: [NOVA], missing: ['artwork'] } };

  it('draws one chip per filter from ?f=, resolves the artist’s name and removes one at a time', async () => {
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, [song('s1', 'Home')]));
    mount();
    await screen.findByTestId('music-row-s1');
    expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual(['Stage: Inbox', 'Nova', 'Missing artwork']);

    runs.push(() => runBody({ v: 1, subject: 'songs', filter: { stages: ['inbox'], missing: ['artwork'] } }, []));
    fireEvent.click(screen.getByLabelText('Remove filter Nova'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));
    const last = runCalls().at(-1)!;
    const sent = decodeDefinition(new URL(last.url, 'https://app.test').searchParams.get('f'));
    expect(sent.ok && sent.definition.filter).toEqual({ stages: ['inbox'], missing: ['artwork'] });
    // the URL keeps the new filter
    const inUrl = decodeDefinition(new URL(window.location.href).searchParams.get('f'));
    expect(inUrl.ok && inUrl.definition.filter).toEqual({ stages: ['inbox'], missing: ['artwork'] });
  });

  it('Clear all empties the bar and the URL', async () => {
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, []));
    mount();
    await screen.findByText('No songs match');
    runs.push(() => runBody(EMPTY, [song('s1', 'Home')]));
    fireEvent.click(screen.getByText('Clear all'));
    await screen.findByTestId('music-row-s1');
    expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0);
    expect(new URL(window.location.href).searchParams.has('f')).toBe(false);
  });

  it('a corrupt ?f= is ignored: the plain list loads', async () => {
    window.history.replaceState(null, '', '/o/ns/music?f=%25%25');
    runs.push(() => runBody(EMPTY, [song('s1', 'Home')]));
    mount();
    expect(await screen.findByTestId('music-row-s1')).toBeTruthy();
    expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0);
  });
});

describe('the editor', () => {
  it('applies a stage chip as a filter; clauses on credits and splits are offered only with rights.read', async () => {
    runs.push(() => runBody(EMPTY, [song('s1', 'Home')]));
    const { unmount } = mount(['catalog.read']);
    await screen.findByTestId('music-row-s1');
    fireEvent.click(screen.getByText('Filter'));
    const dialog = await screen.findByTestId('filter-editor');
    expect(within(dialog).queryByText('Splits')).toBeNull();
    expect(within(dialog).queryByText('Add a credit filter')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Credits' })).toBeNull(); // not even as a "missing" chip
    expect(within(dialog).queryByText('Involving')).toBeNull();
    expect(within(dialog).queryByText('Legal approval')).toBeNull();

    runs.push(() => runBody({ v: 1, subject: 'songs', filter: { stages: ['selected'] } }, []));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selected' }));
    fireEvent.click(screen.getByText('Apply filters'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual(['Stage: Selected']));
    unmount();

    runs.push(() => runBody(EMPTY, []));
    mount(['catalog.read', 'rights.read']);
    await waitFor(() => expect(runCalls().length).toBeGreaterThan(1));
    fireEvent.click(await screen.findByText('Filter'));
    const rights = await screen.findByTestId('filter-editor');
    expect(within(rights).getByText('Splits')).toBeTruthy();
    expect(within(rights).getByText('Add a credit filter')).toBeTruthy();
    expect(within(rights).getByText('Involving')).toBeTruthy();
  });

  it('a reversed date range is an error in the dialog, not a request', async () => {
    runs.push(() => runBody(EMPTY, []));
    mount();
    await screen.findByText('No songs yet');
    const before = runCalls().length;
    fireEvent.click(screen.getByText('Filter'));
    const dialog = await screen.findByTestId('filter-editor');
    fireEvent.change(within(dialog).getByLabelText('Created from'), { target: { value: '2026-10-05' } });
    fireEvent.change(within(dialog).getByLabelText('Created to'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Apply filters'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/ends before it starts/);
    expect(runCalls()).toHaveLength(before);
  });
});

describe('saving a view', () => {
  it('posts the definition and the name — never rows — and then runs the saved view by id', async () => {
    const def: Definition = { v: 1, subject: 'songs', filter: { missing: ['artwork'] } };
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, [song('s1', 'Home')]));
    mount(['catalog.read', 'catalog.write']);
    await screen.findByTestId('music-row-s1');

    fireEvent.click(screen.getByLabelText('Saved views'));
    fireEvent.click(await screen.findByText('Save as a view…'));
    const dialog = await screen.findByRole('dialog', { name: 'Save this view' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Needs art' } });
    fireEvent.click(within(dialog).getByLabelText(/Share with the organization/));
    fireEvent.click(within(dialog).getByText('Save view'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ subject: 'songs', name: 'Needs art', definition: def, shared: true });
    expect(JSON.stringify(post.body)).not.toMatch(/Home|rows/);
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('view')).toBe(VIEW));
    expect(new URL(window.location.href).searchParams.has('f')).toBe(false);
  });

  it('a member without catalog.write is not offered sharing', async () => {
    const def: Definition = { v: 1, subject: 'songs', filter: { missing: ['artwork'] } };
    window.history.replaceState(null, '', `/o/ns/music?f=${encodeDefinition(def)}`);
    runs.push(() => runBody(def, []));
    views = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://app.test');
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.pathname.endsWith('/views/run')) return ok(runBody(def, []));
      if (url.pathname.endsWith('/views')) return ok({ schemaReady: true, views: [], names: { artists: {}, parties: {}, projects: {} }, canShare: false });
      void init;
      return ok({ contacts: [], parties: [] });
    }));
    mount();
    await screen.findByText('No songs match');
    fireEvent.click(screen.getByLabelText('Saved views'));
    fireEvent.click(await screen.findByText('Save as a view…'));
    const dialog = await screen.findByRole('dialog', { name: 'Save this view' });
    expect(within(dialog).queryByLabelText(/Share with the organization/)).toBeNull();
  });
});

describe('opening a saved view', () => {
  it('?view= runs the view by id and shows its chips; a narrowed view carries a note and cannot be updated', async () => {
    const def: Definition = { v: 1, subject: 'songs', filter: { missing: ['artwork'] } };
    views = [{ id: VIEW, subject: 'songs', name: 'Needs art', shared: true, mine: false, author: 'Una', definition: def, narrowed: true, canEdit: false, canDelete: false, canUnshare: false, updatedAt: 'x' }];
    window.history.replaceState(null, '', `/o/ns/music?view=${VIEW}`);
    runs.push(() => ({ ...runBody(def, [song('s1', 'Home')]), narrowed: true, view: { id: VIEW, name: 'Needs art', shared: true } }));
    mount();
    await screen.findByTestId('music-row-s1');
    expect(runCalls()[0].url).toContain(`view=${VIEW}`);
    expect(screen.getByRole('note').textContent).toMatch(/outside what you can see/);
    expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual(['Missing artwork']);
  });

  it('a view that has gone (404) falls back to the plain list instead of an error', async () => {
    window.history.replaceState(null, '', `/o/ns/music?view=${VIEW}`);
    const original = globalThis.fetch;
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://app.test');
      if (url.pathname.endsWith('/views/run') && url.searchParams.has('view') && first) {
        first = false;
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
      }
      return (original as typeof fetch)(input, init);
    }));
    runs.push(() => runBody(EMPTY, [song('s1', 'Home')]));
    mount();
    expect(await screen.findByTestId('music-row-s1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(new URL(window.location.href).searchParams.has('view')).toBe(false);
  });
});
