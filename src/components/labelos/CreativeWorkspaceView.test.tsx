// @vitest-environment jsdom

/**
 * The artistic direction workspace (LABEL-68): it draws what the route sends, links each card to the screen that edits the
 * thing, says "No direction written yet" for a gap, and shows the creative approval only while the org has it on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { CreativeWorkspaceView } from './CreativeWorkspaceView';
import { OrgShellProvider } from './OrgShellContext';
import { buildArtistCards, sortCreativeReleases, tallyStages, workspaceTotals, type CreativeWorkspace } from '@/lib/labelos/creative-workspace';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const artists = buildArtistCards([
  { id: 'c1', name: 'Nova', avatarUrl: null, direction: { sound: 'Warm, dusty drums', next: 'The autumn EP', keywords: ['dusty', 'warm'] }, references: 2, stages: tallyStages(['inbox', 'in_review', 'selected']), waiting: 2, reviewed: 1, draftReleases: 1, creativeOpen: 1 },
  { id: 'c2', name: 'Kilo', avatarUrl: null, direction: null, references: 0, stages: tallyStages([]), waiting: 0, reviewed: null, draftReleases: 0, creativeOpen: 0 },
]);
const releases = sortCreativeReleases([
  { id: 'r1', title: 'Autumn', state: 'draft', artistId: 'c1', artistName: 'Nova', targetDate: '2026-12-01', releaseDate: null, createdAt: '2026-10-05T00:00:00Z', creative: { status: 'awaiting_approval', stale: false } },
]);
const workspace = (over: Partial<CreativeWorkspace> = {}): CreativeWorkspace => ({
  schemaReady: true, gate: true, canApprove: true, canWrite: true, artists, releases, moreReleases: 0, restricted: 0, totals: workspaceTotals(artists, releases), ...over,
});

let reply: { status: number; body: unknown };
beforeEach(() => {
  reply = { status: 200, body: workspace() };
  vi.stubGlobal('fetch', async () => ({ ok: reply.status < 400, status: reply.status, json: async () => reply.body }) as Response);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shell = (role: 'owner' | 'member', capabilities: string[] = ['creative.read'], kind: 'label' | 'artist' = 'label') => ({
  org: { id: 'o1', name: 'Night Shift', slug: 'ns', kind },
  role,
  scope: 'org' as const,
  capabilities: capabilities as never[],
  viewerIsProducer: false,
});
const view = (role: 'owner' | 'member' = 'member', caps?: string[], kind: 'label' | 'artist' = 'label') =>
  render(
    <OrgShellProvider value={shell(role, caps, kind)}>
      <CreativeWorkspaceView orgId="o1" orgSlug="ns" />
    </OrgShellProvider>,
  );

describe('CreativeWorkspaceView', () => {
  it('draws each artist with the brief, keywords, counts and the stage tally; links to where it is edited', async () => {
    view();
    const nova = await screen.findByTestId('creative-artist-c1');
    expect(within(nova).getByText('Warm, dusty drums')).toBeTruthy();
    expect(within(nova).getByText('The autumn EP')).toBeTruthy();
    expect(within(nova).getByText('dusty')).toBeTruthy();
    expect(screen.getByTestId('creative-refs-c1').textContent).toBe('2 references');
    expect(screen.getByTestId('creative-songs-c1').textContent).toBe('3 songs');
    expect(screen.getByTestId('creative-stages-c1').textContent).toBe('Inbox 1 · In review 1 · Selected 1');
    expect(screen.getByTestId('creative-open-direction-c1').getAttribute('href')).toBe('/o/ns/artists/c1?tab=direction');
  });

  it('a gap is said in words and offers to write it, to someone who can', async () => {
    view();
    expect((await screen.findByTestId('creative-nodirection-c2')).textContent).toBe('No direction written yet.');
    expect(screen.getByTestId('creative-open-direction-c2').textContent).toContain('Write the direction');
    cleanup();
    reply = { status: 200, body: workspace({ canWrite: false }) };
    view();
    await screen.findByTestId('creative-nodirection-c2');
    expect(screen.getByTestId('creative-open-direction-c2').textContent).toContain('Open direction');
  });

  it('songs waiting link to the A&R inbox only for a member who can review; otherwise they are just a number', async () => {
    view('member', ['creative.read', 'catalog.read', 'review.write']);
    expect((await screen.findByTestId('creative-waiting-c1')).getAttribute('href')).toBe('/o/ns/ar');
    cleanup();
    // LABEL-70: an independent artist org has no A&R queue (/ar is a 404 there), so the count is plain text even for its owner.
    view('owner', ['creative.read', 'catalog.read', 'review.write'], 'artist');
    expect((await screen.findByTestId('creative-waiting-c1')).getAttribute('href')).toBeNull();
    cleanup();
    view('member', ['creative.read']);
    const plain = await screen.findByTestId('creative-waiting-c1');
    expect(plain.getAttribute('href')).toBeNull();
    expect(plain.textContent).toBe('2 waiting for review');
  });

  it('gate ON: the stat is the open approvals and each release carries its status in words', async () => {
    view();
    await screen.findByTestId('creative-workspace');
    expect(screen.getByTestId('creative-stat-open').textContent).toContain('1');
    expect(screen.getByTestId('creative-release-status-r1').textContent).toBe('Awaiting creative approval');
    expect(screen.getByTestId('creative-gate-on').textContent).toContain('on the release page');
    expect(screen.getByTestId('creative-release-r1').querySelector('a')?.getAttribute('href')).toBe('/o/ns/releases/r1');
  });

  it('gate OFF: no status chips, no "open approvals" stat, and only the owner is pointed at the setting', async () => {
    const off = workspace({ gate: false, releases: releases.map((r) => ({ ...r, creative: null })), totals: workspaceTotals(artists, []) });
    reply = { status: 200, body: off };
    view('member');
    await screen.findByTestId('creative-gate-off');
    expect(screen.queryByTestId('creative-stat-open')).toBeNull();
    expect(screen.queryByTestId('creative-release-status-r1')).toBeNull();
    expect(screen.queryByText(/switch it on in settings/i)).toBeNull();
    cleanup();
    reply = { status: 200, body: off };
    view('owner');
    await screen.findByTestId('creative-gate-off');
    expect(screen.getByRole('link', { name: /switch it on in settings/i }).getAttribute('href')).toBe('/o/ns/settings/organization');
  });

  it('says how many songs are hidden for the role, never which', async () => {
    reply = { status: 200, body: workspace({ restricted: 2 }) };
    view();
    expect((await screen.findByTestId('creative-restricted')).textContent).toContain('2 songs are still in development');
  });

  it('before migration 152 it says direction is not set up and still shows the rest', async () => {
    reply = { status: 200, body: workspace({ schemaReady: false }) };
    view();
    await screen.findByTestId('creative-not-ready');
    expect(screen.getByTestId('creative-artist-c1')).toBeTruthy();
  });

  it('an empty roster and a failed load are said plainly', async () => {
    reply = { status: 200, body: workspace({ artists: [], releases: [], totals: workspaceTotals([], []) }) };
    view();
    await screen.findByTestId('creative-empty');
    expect(screen.getByTestId('creative-no-releases')).toBeTruthy();
    cleanup();
    reply = { status: 500, body: {} };
    view();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i));
  });
});
