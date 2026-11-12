// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtistActivityTab } from './ArtistActivityTab';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const event = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id, verb: 'song.created', at, actorId: 'sam', artistId: 'c1', projectId: null, songId: null, releaseId: null,
  subjectType: 'track', subjectId: id, visibility: 'artist', summary: {}, ...over,
});
const page = (events: unknown[], over: Record<string, unknown> = {}) => ({
  events, names: { actors: { sam: 'Sam' }, artists: { c1: 'Nova' }, releases: {} }, projectArtists: {},
  restricted: 0, hasMore: false, nextBefore: null, asOf: '2026-10-06T00:00:00.000Z', ...over,
});
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('ArtistActivityTab', () => {
  it('asks for THIS artist’s feed and draws day → actor lines', async () => {
    fetchMock.mockReturnValueOnce(reply(page([event('e1', '2026-09-14T09:00:00.000Z')])));
    render(<ArtistActivityTab orgId="o1" orgSlug="acme" contactId="c1" />);
    expect(screen.getByTestId('activity-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('artist-activity')).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/org/o1/activity?limit=100&artist=c1');
    expect(screen.getByTestId('digest-line').textContent).toContain('Sam added a song');
    expect(screen.queryByTestId('activity-more')).toBeNull();
  });

  it('pages backwards with "Show earlier", appending without repeating', async () => {
    fetchMock
      .mockReturnValueOnce(reply(page([event('e2', '2026-09-15T09:00:00.000Z', { actorId: 'sam' })], { hasMore: true, nextBefore: '2026-09-15T09:00:00.000Z_e2' })))
      .mockReturnValueOnce(reply(page([event('e1', '2026-09-14T09:00:00.000Z', { actorId: 'sam' })])));
    render(<ArtistActivityTab orgId="o1" orgSlug="acme" contactId="c1" />);
    await waitFor(() => expect(screen.getByTestId('activity-more')).toBeTruthy());
    fireEvent.click(screen.getByTestId('activity-more'));
    await waitFor(() => expect(screen.getAllByTestId('digest-line')).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/org/o1/activity?limit=100&artist=c1&before=${encodeURIComponent('2026-09-15T09:00:00.000Z_e2')}`);
    expect(screen.queryByTestId('activity-more')).toBeNull();
  });

  it('says so when there is no activity, and when the load fails', async () => {
    fetchMock.mockReturnValueOnce(reply(page([])));
    const { unmount } = render(<ArtistActivityTab orgId="o1" orgSlug="acme" contactId="c1" />);
    await waitFor(() => expect(screen.getByTestId('activity-empty').textContent).toBe('No activity yet.'));
    unmount();
    fetchMock.mockReturnValueOnce(reply({ error: 'Could not load the activity' }, 500));
    render(<ArtistActivityTab orgId="o1" orgSlug="acme" contactId="c1" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not load the activity'));
  });

  it('keeps a restricted count visible when that is all there is', async () => {
    fetchMock.mockReturnValueOnce(reply(page([], { restricted: 2 })));
    render(<ArtistActivityTab orgId="o1" orgSlug="acme" contactId="c1" />);
    await waitFor(() => expect(screen.getByTestId('digest-restricted').textContent).toContain('2 updates'));
  });
});
