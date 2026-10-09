// @vitest-environment jsdom

/**
 * The org credits strip (LABEL-27): a pill per person with its status and
 * party, Confirm / Dispute where the server says the viewer may, a propose
 * form that never offers another person's name to a member without
 * rights.write, and nothing at all for a member with no credits ability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import { CREDIT_ROLES } from '@/lib/labelos/credit-roles';
import type { CreditView } from '@/lib/labelos/credits';
import type { CreditsPayload } from '@/lib/labelos/credits-client';
import { OrgCredits } from './OrgCredits';

const view = (over: Partial<CreditView> = {}): CreditView => ({
  id: 'c1', trackId: 't1', name: 'Pierre', role: 'mixer', roleLabel: 'Mixer', scope: 'recording', status: 'proposed', roleDetail: null,
  source: 'manual', partyId: 'p1', contactId: null, mine: false, proposedByMe: false, confirmedAt: null, disputeNote: null,
  createdAt: '2026-10-01T10:00:00Z',
  party: { id: 'p1', kind: 'person', displayName: 'Pierre', contactId: null, legal: { legalName: 'Pierre Producteur', email: null, ipi: '00123456789', isni: null, pro: 'SACEM', proAffiliation: 'affiliated', publisherName: null, publisherIpi: null } },
  can: { confirm: true, dispute: true },
  ...over,
});
const roles = CREDIT_ROLES.map((r) => ({ key: r.key, label: r.label, scope: r.scope, detail: r.detail ?? null }));
const payload = (over: Partial<CreditsPayload> = {}): CreditsPayload => ({
  schemaReady: true,
  credits: [view()],
  me: { reach: 'all', canPropose: true, canWrite: true, ownPartyId: null },
  roles,
  ...over,
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let responder: (call: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status, body } = responder(call);
    return { ok: status < 400, status, json: async () => body } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toasts = () => useToastStore.getState().toasts.map((t) => `${t.kind}:${t.title}`);

describe('OrgCredits', () => {
  it('draws a pill per person with its status and party, and the full credit on click (legal data only if the server sent it)', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<OrgCredits orgId="o1" trackId="t1" />);
    const pill = await screen.findByTestId('credit-person');
    expect(pill.textContent).toContain('Pierre');
    expect(pill.textContent).toContain('Mixer');
    expect(screen.getByTestId('credit-status').textContent).toBe('proposed');
    expect(pill.getAttribute('data-status')).toBe('proposed');
    expect(pill.getAttribute('title')).toBe('Pierre · Mixer · proposed');
    expect(within(pill).getByLabelText('Linked to a rights holder')).toBeTruthy();

    fireEvent.click(pill);
    expect(screen.getByTestId('credit-party').textContent).toBe('Rights holder: Pierre (Pierre Producteur) · IPI 00123456789 · SACEM');
  });

  it('shows no legal line for a party the server withheld it from, and says when no party is behind a credit', async () => {
    responder = () => ({
      status: 200,
      body: payload({
        credits: [view({ party: { id: 'p1', kind: 'person', displayName: 'Pierre', contactId: null }, can: { confirm: false, dispute: false } }), view({ id: 'c2', name: 'Ed', partyId: null, party: null, role: 'mastering_engineer', roleLabel: 'Mastering Engineer', status: 'confirmed', can: { confirm: false, dispute: false } })],
      }),
    });
    render(<OrgCredits orgId="o1" trackId="t1" />);
    const pills = await screen.findAllByTestId('credit-person');
    const ed = pills.find((p) => p.textContent?.includes('Ed'))!;
    expect(ed.getAttribute('title')).toBe('Ed · Mastering Engineer · confirmed · no rights-holder party');
    expect(within(ed).queryByTestId('credit-status')).toBeNull(); // a confirmed credit is quiet
    fireEvent.click(pills.find((p) => p.textContent?.includes('Pierre'))!);
    expect(screen.getByTestId('credit-party').textContent).toBe('Rights holder: Pierre');
    expect(screen.queryByTestId('credit-confirm')).toBeNull();
  });

  it('Confirm sends the decision and the pill’s status follows the answer', async () => {
    responder = (call) =>
      call.method === 'PATCH'
        ? { status: 200, body: { credit: view({ status: 'confirmed', can: { confirm: false, dispute: true } }) } }
        : { status: 200, body: payload() };
    render(<OrgCredits orgId="o1" trackId="t1" />);
    fireEvent.click(await screen.findByTestId('credit-person'));
    fireEvent.click(screen.getByTestId('credit-confirm'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/org/o1/tracks/t1/credits/c1', body: { action: 'confirm' } });
    await waitFor(() => expect(screen.getByTestId('credit-person').getAttribute('data-status')).toBe('confirmed'));
    expect(toasts()).toContain('success:Credit confirmed');
  });

  it('Dispute takes an optional reason', async () => {
    responder = (call) =>
      call.method === 'PATCH'
        ? { status: 200, body: { credit: view({ status: 'disputed', disputeNote: 'wrong role' }) } }
        : { status: 200, body: payload() };
    render(<OrgCredits orgId="o1" trackId="t1" />);
    fireEvent.click(await screen.findByTestId('credit-person'));
    fireEvent.click(screen.getByTestId('credit-dispute'));
    fireEvent.change(screen.getByTestId('credit-dispute-note'), { target: { value: ' wrong role ' } });
    fireEvent.click(screen.getByTestId('credit-dispute-send'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ action: 'dispute', note: 'wrong role' });
    await waitFor(() => expect(screen.getByTestId('credit-person').getAttribute('data-status')).toBe('disputed'));
  });

  it('a refused decision toasts the server’s words and leaves the pill alone', async () => {
    responder = (call) => (call.method === 'PATCH' ? { status: 403, body: { error: 'Someone else has to confirm a credit you proposed' } } : { status: 200, body: payload() });
    render(<OrgCredits orgId="o1" trackId="t1" />);
    fireEvent.click(await screen.findByTestId('credit-person'));
    fireEvent.click(screen.getByTestId('credit-confirm'));
    await waitFor(() => expect(toasts()).toContain('error:Someone else has to confirm a credit you proposed'));
    expect(screen.getByTestId('credit-person').getAttribute('data-status')).toBe('proposed');
  });

  it('a member with an own line is offered "Credit me" — no name, no party — and posts only the role', async () => {
    responder = (call) =>
      call.method === 'POST'
        ? { status: 201, body: { credit: view({ id: 'c9', status: 'proposed', mine: true }) } }
        : { status: 200, body: payload({ credits: [], me: { reach: 'own', canPropose: true, canWrite: false, ownPartyId: null } }) };
    render(<OrgCredits orgId="o1" trackId="t1" />);
    fireEvent.click(await screen.findByTestId('credit-add'));
    expect(screen.queryByLabelText('Rights holder')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Credit role/ }));
    fireEvent.click(screen.getByRole('option', { name: /Mixer/ }));
    fireEvent.click(screen.getByTestId('credit-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/org/o1/tracks/t1/credits', body: { role: 'mixer' } });
    expect(Object.keys((calls.find((c) => c.method === 'POST')!.body as object))).toEqual(['role']);
  });

  it('a rights writer picks a party or types a name, and an instrumentalist is asked which instrument', async () => {
    responder = (call) => {
      if (call.method === 'POST') return { status: 201, body: { credit: view({ id: 'c9' }) } };
      if (call.url.endsWith('/parties')) return { status: 200, body: { parties: [{ id: 'p7', kind: 'person', displayName: 'Nova', contactId: null }] } };
      return { status: 200, body: payload({ credits: [] }) };
    };
    render(<OrgCredits orgId="o1" trackId="t1" />);
    fireEvent.click(await screen.findByTestId('credit-add'));
    const submit = screen.getByTestId('credit-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ed Mastering' } });
    fireEvent.click(screen.getByRole('button', { name: /Credit role/ }));
    fireEvent.click(screen.getByRole('option', { name: /Instrumentalist/ }));
    fireEvent.change(await screen.findByLabelText('Instrument'), { target: { value: 'Rhodes' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ role: 'instrumentalist', role_detail: 'Rhodes', name: 'Ed Mastering' });
  });

  it('renders nothing for a member with no credits ability (403), and before migration 153', async () => {
    responder = () => ({ status: 403, body: { error: 'Forbidden' } });
    const first = render(<OrgCredits orgId="o1" trackId="t1" />);
    await waitFor(() => expect(first.container.innerHTML).toBe(''));
    first.unmount();
    responder = () => ({ status: 200, body: payload({ schemaReady: false, credits: [] }) });
    const second = render(<OrgCredits orgId="o1" trackId="t1" />);
    await waitFor(() => expect(second.container.innerHTML).toBe(''));
  });

  it('says so when there is nothing to show and nothing to add', async () => {
    responder = () => ({ status: 200, body: payload({ credits: [], me: { reach: 'own', canPropose: false, canWrite: false, ownPartyId: null } }) });
    render(<OrgCredits orgId="o1" trackId="t1" />);
    expect((await screen.findByText('No credits you can see yet.'))).toBeTruthy();
    expect(screen.queryByTestId('credit-add')).toBeNull();
  });
});
