// @vitest-environment jsdom

/**
 * The legal queue screen (LABEL-31): what it draws from what the route sent.
 * Order and visibility are the server's (legal-queue.test.ts, the route test);
 * here only: blockers not a percentage, who may take a pack, the empty, failed
 * and not-set-up states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { LegalQueueView, waitingFor } from './LegalQueueView';
import { OrgShellProvider, type OrgShellValue } from './OrgShellContext';
import type { LegalQueueItem } from '@/lib/labelos/legal-queue';

const item = (over: Partial<LegalQueueItem> = {}): LegalQueueItem => ({
  kind: 'song',
  id: 'a1',
  title: 'Midnight',
  artist: { id: 'c1', name: 'Nova' },
  requestedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  requestedBy: 'Ari A&R',
  askedOfMe: false,
  ready: false,
  blockers: 2,
  ...over,
});

let reply: { status: number; body: unknown };
const shell = (caps: string[]): OrgShellValue => ({ org: { id: 'org1', name: 'Night Shift', slug: 'ns', kind: 'label' }, role: 'member', scope: 'org', capabilities: caps as never, viewerIsProducer: false });
const mount = (caps = ['catalog.read', 'release.approve.legal', 'contracts.read', 'rights.read']) =>
  render(
    <OrgShellProvider value={shell(caps)}>
      <LegalQueueView orgId="org1" orgSlug="ns" />
    </OrgShellProvider>,
  );

beforeEach(() => {
  vi.stubGlobal('fetch', async () => ({ ok: reply.status < 400, status: reply.status, json: async () => reply.body }) as Response);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rows', () => {
  it('says blockers, not a score; "No blockers" for a ready one; who asked and how long', async () => {
    reply = { status: 200, body: { schemaReady: true, restricted: 0, truncated: false, items: [item({ id: 'r', ready: true, blockers: 0, title: 'Dawn', askedOfMe: true }), item()] } };
    mount();
    const rows = await screen.findAllByTestId('legal-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId('legal-readiness').textContent).toBe('No blockers');
    expect(within(rows[0]).getByText('Asked of you')).toBeTruthy();
    expect(within(rows[1]).getByTestId('legal-readiness').textContent).toBe('2 blockers');
    expect(rows[1].textContent).toContain('Nova · Asked by Ari A&R · waiting 3 days');
    expect(rows[1].textContent).not.toMatch(/%|score/i);
    expect(within(rows[1]).getByRole('link', { name: 'Midnight' }).getAttribute('href')).toBe('/o/ns/songs/a1');
  });

  it('a release offers its legal pack to a member who may take it — a link to the server, with no file URL', async () => {
    reply = { status: 200, body: { schemaReady: true, restricted: 0, truncated: false, items: [item({ kind: 'release', id: 'rel1', title: 'Nova EP' })] } };
    mount();
    const link = await screen.findByTestId('legal-pack-link');
    expect(link.getAttribute('href')).toBe('/api/org/org1/releases/rel1/legal-pack');
  });

  it('no legal pack link without contracts.read and rights.read, and none on a song', async () => {
    reply = { status: 200, body: { schemaReady: true, restricted: 0, truncated: false, items: [item({ kind: 'release', id: 'rel1', title: 'Nova EP' }), item()] } };
    mount(['catalog.read', 'release.approve.legal']);
    await screen.findAllByTestId('legal-row');
    expect(screen.queryByTestId('legal-pack-link')).toBeNull();
    cleanup();
    mount();
    await screen.findAllByTestId('legal-row');
    expect(screen.getAllByTestId('legal-pack-link')).toHaveLength(1);
  });
});

describe('states', () => {
  it('empty', async () => {
    reply = { status: 200, body: { schemaReady: true, restricted: 0, truncated: false, items: [] } };
    mount();
    expect(await screen.findByTestId('legal-empty')).toBeTruthy();
  });
  it('counts what the member cannot open, without naming it', async () => {
    reply = { status: 200, body: { schemaReady: true, restricted: 2, truncated: false, items: [item()] } };
    mount();
    expect((await screen.findByTestId('legal-restricted')).textContent).toContain('2 more requests are waiting on songs or releases you cannot open');
  });
  it('not set up yet', async () => {
    reply = { status: 200, body: { schemaReady: false, restricted: 0, truncated: false, items: [] } };
    mount();
    expect(await screen.findByTestId('legal-not-ready')).toBeTruthy();
  });
  it('shows the server’s own words when it fails', async () => {
    reply = { status: 403, body: { error: 'Forbidden' } };
    mount();
    await waitFor(() => expect(screen.getByTestId('legal-failed').textContent).toContain('Forbidden'));
  });
});

describe('waitingFor', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('reads in days, weeks and months', () => {
    expect(waitingFor('2026-10-13T01:00:00Z', now)).toBe('today');
    expect(waitingFor('2026-10-12T00:00:00Z', now)).toBe('1 day');
    expect(waitingFor('2026-10-08T00:00:00Z', now)).toBe('5 days');
    expect(waitingFor('2026-09-22T00:00:00Z', now)).toBe('3 weeks');
    expect(waitingFor('2026-06-01T00:00:00Z', now)).toBe('4 months');
    expect(waitingFor('2027-01-01T00:00:00Z', now)).toBe('today');
  });
});
