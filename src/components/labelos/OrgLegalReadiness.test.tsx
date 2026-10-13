// @vitest-environment jsdom

/**
 * The legal readiness chip and Credits & Rights table (LABEL-29): named gaps
 * for a reader with rights.read, counts only (no table, no names) without it,
 * the percentage always next to the line that says blockers decide, and
 * nothing at all when the route says no.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { evaluateLegalReadiness, readinessView, type LegalFacts } from '@/lib/labelos/legal-readiness';
import { OrgLegalReadiness } from './OrgLegalReadiness';

const facts: LegalFacts = {
  title: 'Midnight',
  credits: [{ id: 'c1', role: 'songwriter', scope: 'composition', status: 'confirmed', partyId: 'p1', name: 'Nova' }],
  parties: [{ id: 'p1', displayName: 'Nova', legalName: null, ipi: null, pro: null, proAffiliation: 'unknown', publisherName: null }],
  sheets: [],
  onRelease: false,
  samples: 'none',
  sampleClearance: false,
  requireSignedMasterSplit: false,
  isrc: null,
};
const result = evaluateLegalReadiness(facts);

let reply: { status: number; body: unknown };

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async () => ({ ok: reply.status < 400, status: reply.status, json: async () => reply.body }) as Response);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('with rights.read', () => {
  beforeEach(() => {
    reply = { status: 200, body: { schemaReady: true, readiness: readinessView(result, true) } };
  });

  it('shows the percentage, the blockers and one row per requirement with the gap named', async () => {
    render(<OrgLegalReadiness orgId="o" trackId="t" />);
    expect((await screen.findByTestId('org-legal-percent')).textContent).toContain(`${result.score.percent}%`);
    expect(screen.getByTestId('org-legal-chip').textContent).toContain(`${result.blockers.length} blocking`);
    expect(within(screen.getByTestId('org-legal-row-L3')).getByText('Nova has no legal name.')).toBeTruthy();
    expect(screen.getByTestId('org-legal-row-L3').getAttribute('data-state')).toBe('blocker');
    expect(screen.getByTestId('org-legal-row-L10').getAttribute('data-state')).toBe('na'); // not on a release
    expect(screen.getByTestId('org-legal-row-L1').getAttribute('data-state')).toBe('ok');
  });

  it('the popover lists what is complete and missing, and says the percentage decides nothing', async () => {
    render(<OrgLegalReadiness orgId="o" trackId="t" />);
    fireEvent.click(await screen.findByTestId('org-legal-chip'));
    const panel = await screen.findByTestId('org-legal-panel');
    expect(within(panel).getByText('Song title')).toBeTruthy();
    expect(within(panel).getByText('Nova has no legal name.')).toBeTruthy();
    expect(panel.textContent).toContain('display only');
    expect(panel.textContent).toContain('blockers, not the percentage');
  });
});

describe('without rights.read', () => {
  it('shows the counts and nothing that names a person', async () => {
    reply = { status: 200, body: { schemaReady: true, readiness: readinessView(result, false) } };
    render(<OrgLegalReadiness orgId="o" trackId="t" />);
    expect((await screen.findByTestId('org-legal-counts')).textContent).toContain(`${result.blockers.length} blockers`);
    expect(screen.queryByTestId('org-legal-table')).toBeNull();
    fireEvent.click(screen.getByTestId('org-legal-chip'));
    const panel = await screen.findByTestId('org-legal-panel');
    expect(panel.textContent).toContain('display only');
    expect(document.body.textContent).not.toContain('Nova');
  });
});

describe('when there is nothing to show', () => {
  it.each([
    ['forbidden', { status: 403, body: { error: 'Forbidden' } }],
    ['not found', { status: 404, body: { error: 'Not found' } }],
    ['migration missing', { status: 200, body: { schemaReady: false } }],
  ])('%s renders nothing', async (_n, r) => {
    reply = r;
    const { container } = render(<OrgLegalReadiness orgId="o" trackId="t" />);
    await waitFor(() => expect(screen.queryByTestId('org-legal-loading')).toBeNull());
    expect(container.textContent).toBe('');
  });
});
