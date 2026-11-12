// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActivityFeed } from '@/lib/labelos/activity-store';
import { OverviewDigest } from './OverviewDigest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const fetchMock = vi.fn(async () => new Response('{}'));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const feed = (over: Partial<ActivityFeed> = {}): ActivityFeed => ({
  events: [
    { id: 'e1', verb: 'song.created', at: '2026-10-05T09:00:00.000Z', actorId: 'sam', artistId: 'nova', projectId: null, songId: null, releaseId: null, subjectType: 'track', subjectId: 's1', visibility: 'artist', summary: { stage: 'inbox' } },
  ],
  names: { actors: { sam: 'Sam' }, artists: { nova: 'Nova' }, releases: {} },
  projectArtists: {},
  restricted: 0,
  hasMore: false,
  nextBefore: null,
  asOf: '2026-10-06T08:00:00.000Z',
  ...over,
});

const SINCE = '2026-09-29T08:00:00.000Z';
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('OverviewDigest', () => {
  it('shows the digest under "Since your last visit"', () => {
    render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt="2026-10-04T00:00:00.000Z" />);
    expect(screen.getByText('Since your last visit')).toBeTruthy();
    expect(screen.getByTestId('digest-line').textContent).toContain('Sam added a demo');
    expect(fetchMock).not.toHaveBeenCalled(); // opening it is not "seen" — no interruption, no write on load
  });

  it('marks the digest seen THROUGH asOf when the member leaves, once', async () => {
    const { unmount } = render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt={null} />);
    await tick();
    unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/org/o1/overview/seen');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ through: '2026-10-06T08:00:00.000Z' });
    expect(init.keepalive).toBe(true);
  });

  it('does not mark seen on a mount that is torn down at once (StrictMode’s rehearsal)', () => {
    const { unmount } = render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt={null} />);
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('"Mark all seen" clears the list and marks it seen now', async () => {
    render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt={null} />);
    fireEvent.click(screen.getByTestId('digest-mark-seen'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('digest-empty').textContent).toBe('All seen.');
    expect(screen.queryAllByTestId('digest-line')).toEqual([]);
  });

  it('says plainly when nothing is new, and when nothing was ever seen', () => {
    const { unmount } = render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed({ events: [] })} lastSeenAt="2026-10-04T00:00:00.000Z" />);
    expect(screen.getByTestId('digest-empty').textContent).toBe('Nothing new since your last visit.');
    unmount();
    render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed({ events: [] })} lastSeenAt={null} />);
    expect(screen.getByTestId('digest-empty').textContent).toBe('Nothing in the last 7 days.');
  });

  it('keeps showing restricted updates even when nothing else is listed, and notes a truncated feed', () => {
    render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed({ events: [], restricted: 3, hasMore: true, nextBefore: null })} lastSeenAt={null} />);
    expect(screen.getByTestId('digest-restricted').textContent).toContain('3 updates');
    expect(screen.queryByTestId('digest-more')).toBeNull(); // no cursor, so no button
  });
  it('does not mark seen when the member merely switches to another tab', async () => {
    const { unmount } = render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt={null} />);
    await tick();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(fetchMock).not.toHaveBeenCalled();
    unmount(); // leaving still marks it
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a refreshed feed (a new asOf) is not marked seen by the refresh; leaving marks the NEW instant', async () => {
    const { rerender, unmount } = render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed()} lastSeenAt={null} />);
    await tick();
    rerender(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed({ asOf: '2026-10-06T09:00:00.000Z' })} lastSeenAt={null} />);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ through: '2026-10-06T09:00:00.000Z' });
  });

  it('"Show earlier" pages the digest from the same lower bound and appends', async () => {
    const older = { ...feed().events[0], id: 'e0', at: '2026-10-04T09:00:00.000Z' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...feed({ events: [older] }) })));
    render(<OverviewDigest orgId="o1" orgSlug="acme" viewerId="me" since={SINCE} feed={feed({ hasMore: true, nextBefore: '2026-10-05T09:00:00.000Z_e1' })} lastSeenAt={null} />);
    expect(screen.getAllByTestId('digest-line')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('digest-more'));
    await waitFor(() => expect(screen.getAllByTestId('digest-line')).toHaveLength(2));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`/api/org/o1/activity?limit=200&since=${encodeURIComponent(SINCE)}&before=${encodeURIComponent('2026-10-05T09:00:00.000Z_e1')}`);
    expect(screen.queryByTestId('digest-more')).toBeNull();
  });
});
