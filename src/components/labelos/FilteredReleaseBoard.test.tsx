// @vitest-environment jsdom

/**
 * The Releases page with the filter bar (LABEL-37): no filter = the board the
 * server rendered, untouched and with no request; a filter = the rows the
 * server returns for this member, drawn by the same board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilteredReleaseBoard } from './FilteredReleaseBoard';
import { OrgShellProvider, type OrgShellValue } from './OrgShellContext';
import { encodeDefinition, type Definition } from '@/lib/labelos/filters';
import { boardGates, type BoardRelease } from '@/lib/labelos/release-board';
import { RELEASE_GATES } from '@/lib/labelos/release-readiness';

const ORG = '10000000-0000-4000-8000-000000000001';
const shell: OrgShellValue = { org: { id: ORG, name: 'Night Shift', slug: 'ns', kind: 'label' }, role: 'member', scope: 'org', capabilities: ['catalog.read'], viewerIsProducer: false };
const gates = boardGates(Object.fromEntries(RELEASE_GATES.map((g) => [g, { status: 'satisfied', blockerCount: 0 }])) as Parameters<typeof boardGates>[0]);
const rel = (id: string, over: Partial<BoardRelease> = {}): BoardRelease => ({
  id, title: `Title ${id}`, type: 'single', state: 'draft', artistId: 'a', artistName: 'Nova', targetDate: '2026-12-01', releaseDate: null,
  deliveredAt: null, deliveredTo: null, itemCount: 1, gates, readyToDeliver: false, createdAt: '2026-10-01T00:00:00Z', ...over,
});

let urls: string[];
let answer: (url: URL) => unknown;

beforeEach(() => {
  urls = [];
  window.history.replaceState(null, '', '/o/ns/releases');
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'https://app.test');
    urls.push(url.pathname + url.search);
    const body = url.pathname.endsWith('/views/run') ? answer(url) : url.pathname.endsWith('/views') ? { schemaReady: true, views: [], names: { artists: {}, parties: {}, projects: {} }, canShare: false } : { contacts: [] };
    return { ok: true, status: 200, json: async () => body };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () => render(<OrgShellProvider value={shell}><FilteredReleaseBoard orgSlug="ns" releases={[rel('r1'), rel('r2')]} more={0} schemaReady initialFilter="all" /></OrgShellProvider>);

describe('FilteredReleaseBoard', () => {
  it('with no filter it is the server board and makes no run request', async () => {
    mount();
    expect(screen.getByTestId('release-row-r1')).toBeTruthy();
    expect(screen.getByTestId('release-row-r2')).toBeTruthy();
    await waitFor(() => expect(urls.some((u) => u.includes('/views?'))).toBe(true));
    expect(urls.some((u) => u.includes('/views/run'))).toBe(false);
  });

  it('with ?f= it draws the rows the server returned for this member, and says when none match', async () => {
    const def: Definition = { v: 1, subject: 'releases', filter: { states: ['draft'], gates: [{ gate: 'legal', status: ['awaiting_approval'] }] } };
    window.history.replaceState(null, '', `/o/ns/releases?f=${encodeDefinition(def)}`);
    answer = () => ({ result: { kind: 'releases', rows: [rel('r2')], total: 1, more: false, olderNotShown: 0, schemaReady: true }, definition: def, narrowed: false, names: { artists: {}, parties: {}, projects: {} }, view: null });
    mount();
    expect(await screen.findByTestId('release-row-r2')).toBeTruthy();
    expect(screen.queryByTestId('release-row-r1')).toBeNull();
    expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual(['State: draft', 'Legal: awaiting approval']);

    answer = () => ({ result: { kind: 'releases', rows: [], total: 0, more: false, olderNotShown: 0, schemaReady: true }, definition: { v: 1, subject: 'releases', filter: { states: ['draft'] } }, narrowed: false, names: { artists: {}, parties: {}, projects: {} }, view: null });
    fireEvent.click(screen.getByLabelText('Remove filter Legal: awaiting approval'));
    expect(await screen.findByText('No releases match')).toBeTruthy();
  });
});
