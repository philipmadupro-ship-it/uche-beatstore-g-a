// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { ActivityPanel } from './ActivityPanel';

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const item = (id: string, kind: string, group: string, title: string, at: string, href: string | null = null) =>
  ({ id, kind, group, tone: 'neutral', at, title, href });

// Built after the clock is pinned (a module-level array would use the real time).
const feed = () => [
  item('1', 'sale', 'sales', 'New sale — Night Shift ($29.00)', ago(5), '/sales'),
  item('2', 'artist_reaction', 'artists', 'Nova is interested in “Night Shift”', ago(30), '/contacts/c1?tab=beats'),
  item('3', 'upload', 'music', 'Uploaded “Cold Front”', ago(60 * 30), '/library/t2'),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ activity: feed() }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('ActivityPanel', () => {
  it('offers only the groups that have rows, with counts, and filters by them', async () => {
    render(<ActivityPanel open onClose={() => {}} />);
    await screen.findByText('New sale — Night Shift ($29.00)');
    const chips = within(screen.getByRole('group', { name: /filter activity/i }));
    expect(chips.getByRole('button', { name: /^All\s*3$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(chips.getByRole('button', { name: /Sales\s*1/ })).toBeTruthy();
    expect(chips.queryByRole('button', { name: /Sharing/ })).toBeNull(); // no rows, no chip

    fireEvent.click(chips.getByRole('button', { name: /Artists/ }));
    expect(screen.queryByText('New sale — Night Shift ($29.00)')).toBeNull();
    expect(screen.getByText('Nova is interested in “Night Shift”')).toBeTruthy();
    expect(chips.getByRole('button', { name: /Artists/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('groups rows under day headers and links each row to its subject', async () => {
    render(<ActivityPanel open onClose={() => {}} />);
    await screen.findByText('Uploaded “Cold Front”');
    expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Yesterday' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /New sale/ }).getAttribute('href')).toBe('/sales');
    expect(screen.getByRole('link', { name: /Nova is interested/ }).getAttribute('href')).toBe('/contacts/c1?tab=beats');
  });

  it('chips are real buttons (keyboard reachable) and an empty feed says so without chips', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ activity: [] }) })));
    render(<ActivityPanel open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Nothing yet in the last 7 days/)).toBeTruthy());
    const chips = within(screen.getByRole('group', { name: /filter activity/i })).getAllByRole('button');
    expect(chips).toHaveLength(1);
    expect(chips[0].tagName).toBe('BUTTON');
  });
});
