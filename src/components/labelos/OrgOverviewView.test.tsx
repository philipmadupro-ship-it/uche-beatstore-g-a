// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrgOverviewView } from './OrgOverviewView';
import type { OrgOverview } from '@/lib/labelos/overview-store';

afterEach(cleanup);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', name: 'Nova', avatar_url: null, songs: 3, restricted: 0, stages: [],
  columns: { demos: 2, development: 1, selected: 0 }, nextRelease: null, ...over,
});
const overview = (artists: unknown[], extra: Record<string, unknown> = {}): OrgOverview =>
  ({ artists, totals: { artists: artists.length, songs: 3, restricted: 0, stages: [] }, releasesReady: true, ...extra }) as OrgOverview;

describe('OrgOverviewView', () => {
  it('draws the counts, the next release and a link to the workspace', () => {
    render(<OrgOverviewView orgSlug="acme" limited={false} overview={overview([row({ nextRelease: { id: 'r', title: 'EP 2027', type: 'ep', state: 'draft', targetDate: '2027-03-01', projectId: 'p' } })])} />);
    expect(screen.getByTestId('overview-demos-a1').textContent).toBe('2');
    expect(screen.getByTestId('overview-dev-a1').textContent).toBe('1');
    expect(screen.getByTestId('overview-release-a1').textContent).toBe('EP 2027 · 2027-03-01');
    expect(screen.getByRole('link', { name: 'Open Nova' }).getAttribute('href')).toBe('/o/acme/artists/a1');
    expect(screen.getByTestId('overview-totals').textContent).toBe('1 artist · 3 songs');
  });

  it('says restricted as a number, with no title', () => {
    render(<OrgOverviewView orgSlug="acme" limited={false} overview={overview([row({ restricted: 2 })])} />);
    expect(screen.getByTestId('overview-restricted-a1').textContent).toContain('2 songs restricted');
  });

  it('reads "Not available yet" before releases exist, and an empty roster is explained', () => {
    const { unmount } = render(<OrgOverviewView orgSlug="acme" limited={false} overview={overview([row()], { releasesReady: false })} />);
    expect(screen.getByTestId('overview-release-a1').textContent).toBe('Not available yet');
    unmount();
    render(<OrgOverviewView orgSlug="acme" limited overview={overview([])} />);
    expect(screen.getByTestId('overview-empty').textContent).toContain('not been given any artists');
  });
});
