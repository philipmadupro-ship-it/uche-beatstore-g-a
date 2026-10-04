// @vitest-environment jsdom

/**
 * The org artist workspace (LABEL-17): the producer's tab strip in org
 * context, URL-addressable tabs, and what a member's capabilities leave out
 * rendered as "restricted" rather than as an empty section (07 §3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { OrgArtistWorkspace } from '@/lib/labelos/org-workspace-store';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/projects/ProjectFilesSection', () => ({
  ProjectFilesSection: ({ projectId, org }: { projectId: string; org?: { orgId: string } }) => <div data-testid={`files-${projectId}`}>files of {projectId} in {org?.orgId}</div>,
}));
vi.mock('@/components/labelos/OrgUploadPanel', () => ({ OrgUploadPanel: () => <div data-testid="upload-panel" /> }));

import { OrgArtistWorkspaceTabs } from './OrgArtistWorkspaceTabs';

const ORG = 'o1';

function ws(overrides: Partial<OrgArtistWorkspace> = {}): OrgArtistWorkspace {
  return {
    contact: { id: 'c1', name: 'Nova', avatar_url: null, category: 'artist', secondary_category: null },
    projects: [
      { id: 'p1', name: 'Nova EP', cover_url: null, status: 'in_progress', isInbox: false, songs: 2 },
      { id: 'p2', name: 'Inbox · Nova', cover_url: null, status: 'in_progress', isInbox: true, songs: 1 },
    ],
    songs: [
      { id: 's1', title: 'Midnight', stage: 'selected', cover_url: null, created_at: '2026-01-02', projects: [{ id: 'p1', name: 'Nova EP' }] },
      { id: 's2', title: 'Dawn', stage: 'in_review', cover_url: null, created_at: '2026-01-01', projects: [{ id: 'p1', name: 'Nova EP' }] },
    ],
    restrictedSongs: 0,
    releases: [{
      id: 'r1', title: 'Midnight EP', type: 'ep', state: 'draft', targetDate: null, releaseDate: null, projectId: 'p1',
      items: [
        { position: 1, songTrackId: 's1', title: 'Midnight', restricted: false },
        { position: 2, songTrackId: 's9', title: null, restricted: true },
      ],
    }],
    releasesReady: true,
    permissions: { write: true, working: true, finished: true },
    ...overrides,
  };
}

function open(w = ws()) {
  render(<OrgArtistWorkspaceTabs orgId={ORG} orgSlug="night-shift" workspace={w} />);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/o/night-shift/artists/c1');
});
afterEach(() => cleanup());

describe('OrgArtistWorkspaceTabs', () => {
  it('uses the workspace tab strip with the org tabs, Overview first', () => {
    open();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Projects2', 'Songs2', 'Releases1', 'Files']);
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist', { name: 'Nova workspace' })).toBeTruthy();
  });

  it('switches tabs and keeps the tab in the URL', () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Songs/ }));
    expect(window.location.search).toBe('?tab=songs');
    expect(screen.getByTestId('ows-song-s1')).toBeTruthy();
    expect(within(screen.getByTestId('ows-song-s1')).getByText('Selected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Midnight' }).getAttribute('href')).toBe('/o/night-shift/songs/s1');
    fireEvent.click(screen.getByRole('tab', { name: /Overview/ }));
    expect(window.location.search).toBe('');
  });

  it('opens on the tab the URL names', () => {
    window.history.replaceState(null, '', '/o/night-shift/artists/c1?tab=releases');
    open();
    expect(screen.getByTestId('ows-release-r1')).toBeTruthy();
  });

  it('Overview shows stage counts, the next release and active projects', () => {
    open();
    const counts = screen.getByTestId('ows-stage-counts');
    expect(counts.textContent).toContain('In review');
    expect(counts.textContent).toContain('Selected');
    expect(screen.getByText('Midnight EP')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Nova EP/ }).getAttribute('href')).toBe('/o/night-shift/projects/p1');
  });

  it('marketing: songs it may not hear read "restricted", not an empty list (D4, 07 §3.4)', () => {
    open(ws({ songs: [], restrictedSongs: 3, permissions: { write: false, working: false, finished: true } }));
    fireEvent.click(screen.getByRole('tab', { name: /Songs/ }));
    expect(screen.getByTestId('ows-songs-restricted').textContent).toMatch(/3 songs .* restricted/);
    expect(screen.queryByText(/No songs yet/)).toBeNull();
    expect(screen.queryByTestId('upload-panel')).toBeNull(); // no catalog.write, no upload
  });

  it('a release slot whose song is hidden reads "Restricted song" and names nothing', () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Releases/ }));
    const release = screen.getByTestId('ows-release-r1');
    expect(within(release).getByText('Restricted song')).toBeTruthy();
    expect(within(release).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/o/night-shift/songs/s1']);
  });

  it('says when releases are not available yet instead of looking empty', () => {
    open(ws({ releases: [], releasesReady: false }));
    fireEvent.click(screen.getByRole('tab', { name: /Releases/ }));
    expect(screen.getByText(/migration 144/)).toBeTruthy();
  });

  it('Files mounts the org-mode files section for each project', () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }));
    expect(screen.getByTestId('files-p1').textContent).toBe('files of p1 in o1');
    expect(screen.getByTestId('files-p2')).toBeTruthy();
  });

  it('a member who may write gets the upload panel on Songs', () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Songs/ }));
    expect(screen.getByTestId('upload-panel')).toBeTruthy();
  });
});
