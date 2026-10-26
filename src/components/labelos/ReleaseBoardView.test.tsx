// @vitest-environment jsdom

/**
 * The release board (LABEL-33): rows with a gate strip, the state filter, the
 * URL memory of it, and — by construction — nothing that could move a release
 * to a stage (07 §2.5). What is drawn from what the server read sent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReleaseBoardView } from './ReleaseBoardView';
import { boardGates, type BoardRelease } from '@/lib/labelos/release-board';
import { RELEASE_GATES } from '@/lib/labelos/release-readiness';

afterEach(cleanup);

const gates = (open: string[] = []) =>
  boardGates(Object.fromEntries(RELEASE_GATES.map((g) => [g, { status: open.includes(g) ? 'blocked' : 'satisfied', blockerCount: open.includes(g) ? 2 : 0 }])) as Parameters<typeof boardGates>[0]);
const rel = (id: string, over: Partial<BoardRelease> = {}): BoardRelease => ({
  id, title: `Title ${id}`, type: 'single', state: 'draft', artistId: 'a', artistName: 'Nova', targetDate: '2026-12-01', releaseDate: null,
  deliveredAt: null, deliveredTo: null, itemCount: 2, gates: gates(['legal']), readyToDeliver: false, createdAt: '2026-10-01T00:00:00Z', ...over,
});

const mount = (releases: BoardRelease[], extra: Partial<Parameters<typeof ReleaseBoardView>[0]> = {}) =>
  render(<ReleaseBoardView orgSlug="ns" releases={releases} more={0} schemaReady initialFilter="all" {...extra} />);

describe('rows', () => {
  it('link to the release, say where it stands, and carry a gate strip with the open gates named', () => {
    mount([rel('r1')]);
    const row = screen.getByTestId('release-row-r1');
    expect(within(row).getByTestId('release-row-link').getAttribute('href')).toBe('/o/ns/releases/r1');
    expect(row.getAttribute('data-stage')).toBe('in_progress');
    expect(within(row).getAllByRole('listitem')).toHaveLength(7);
    expect(within(row).getByLabelText('Legal: Blocked · 2 to fix')).toBeTruthy();
    expect(within(row).getByLabelText('Tracklist: Done')).toBeTruthy();
    expect(within(row).getByText('1 of 7 gates open')).toBeTruthy();
  });

  it('a delivered release says to whom and when, with no strip', () => {
    mount([rel('r2', { state: 'delivered', gates: [], deliveredTo: 'DistroKid', deliveredAt: '2026-10-12T12:00:00Z' })]);
    const row = screen.getByTestId('release-row-r2');
    expect(row.textContent).toMatch(/Delivered to DistroKid/);
    expect(within(row).queryByTestId('release-gate-strip')).toBeNull();
  });

  it('offers nothing to drag or move to a stage', () => {
    const { container } = mount([rel('r1'), rel('r2', { readyToDeliver: true })]);
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });
});

describe('the filter', () => {
  const all = [rel('a'), rel('b', { readyToDeliver: true, gates: gates() }), rel('c', { state: 'delivered', gates: [] }), rel('d', { state: 'cancelled', gates: [] })];

  it('counts each state and narrows the list', () => {
    mount(all);
    expect(screen.getByTestId('release-filter-all').textContent).toMatch(/4/);
    expect(screen.getByTestId('release-filter-ready').textContent).toMatch(/1/);
    fireEvent.click(screen.getByTestId('release-filter-ready'));
    expect(screen.getByTestId('release-filter-ready').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('release-row-a')).toBeNull();
    expect(screen.getByTestId('release-row-b')).toBeTruthy();
    expect(window.location.search).toBe('?state=ready');
    fireEvent.click(screen.getByTestId('release-filter-all'));
    expect(window.location.search).toBe('');
    expect(screen.getAllByTestId(/^release-row-[a-d]$/)).toHaveLength(4);
  });

  it('starts from the filter the URL named, and says so when it is empty', () => {
    mount([rel('a')], { initialFilter: 'delivered' });
    expect(screen.getByTestId('release-board-empty').textContent).toMatch(/Nothing is delivered/);
  });
});

describe('the empty and unready boards', () => {
  it('says why there is nothing', () => {
    mount([]);
    expect(screen.getByText('No releases yet')).toBeTruthy();
    cleanup();
    mount([], { schemaReady: false });
    expect(screen.getByText('Releases are not set up yet')).toBeTruthy();
  });

  it('counts the releases it does not show', () => {
    mount([rel('a')], { more: 3 });
    expect(screen.getByText(/3 older releases are not shown/)).toBeTruthy();
  });
});
