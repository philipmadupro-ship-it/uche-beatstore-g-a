// @vitest-environment jsdom

/**
 * The Parties page (LABEL-54): what each viewer is drawn from what the server
 * sent, the editor's request bodies (only the fields that changed), the plain
 * refusal of a bank number before anything is sent, the lock's reason, and the
 * confirm / ask-to-confirm actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import type { PartyView } from '@/lib/labelos/credits';
import type { PartiesPayload } from '@/lib/labelos/credits-client';
import { PartiesView } from './PartiesView';

const legal = (over: Partial<NonNullable<PartyView['legal']>> = {}): NonNullable<PartyView['legal']> => ({
  legalName: 'Nova Okafor', email: 'n@x.test', ipi: '00987654321', isni: null, pro: 'SACEM', proAffiliation: 'affiliated', publisherName: null, publisherIpi: null,
  address: '2 road Y', country: 'GB', confirmedAt: null, ...over,
});
const party = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p1', kind: 'person', displayName: 'Nova', contactId: null, legal: legal(), payee: { taxId: 'GB-TAX-2', paymentInstructions: 'Invoice monthly' }, linkedUserId: 'u-nova', ...over,
});
const payload = (over: Partial<PartiesPayload> = {}): PartiesPayload => ({
  schemaReady: true,
  parties: [party(), party({ id: 'p2', displayName: 'Kilo', legal: legal({ legalName: 'Kilo Writer', country: 'FR', pro: 'ASCAP' }), payee: { taxId: null, paymentInstructions: null }, linkedUserId: null })],
  canWrite: true,
  canSeePayee: true,
  canSeePayments: true,
  members: [{ userId: 'u-nova', name: 'Nova M' }, { userId: 'u-kilo', name: 'Kilo M' }],
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

const writes = () => calls.filter((c) => c.method !== 'GET');
const toasts = () => useToastStore.getState().toasts.map((t) => `${t.kind}:${t.title}`);
const open = async (name: string) => {
  const rows = await screen.findAllByTestId('party-row');
  fireEvent.click(rows.find((r) => r.textContent?.includes(name))!);
  return screen.findByTestId('party-editor');
};

describe('PartiesView — who sees what', () => {
  it('a rights writer sees the legal and payee blocks, editable', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    const editor = await open('Nova');
    expect((within(editor).getByTestId('legal-name') as HTMLInputElement).value).toBe('Nova Okafor');
    expect((within(editor).getByTestId('tax-id') as HTMLInputElement).value).toBe('GB-TAX-2');
    expect((within(editor).getByTestId('payment-instructions') as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByTestId('party-save')).toBeTruthy();
    expect(within(editor).getByText(/never type a bank account, iban or card number/i)).toBeTruthy();
  });

  it('a rights writer without finance access sees the tax id but no payment instructions field', async () => {
    responder = () => ({ status: 200, body: payload({ canSeePayments: false, parties: [party({ payee: { taxId: 'GB-TAX-2' } })] }) });
    render(<PartiesView orgId="o1" />);
    const editor = await open('Nova');
    expect((within(editor).getByTestId('tax-id') as HTMLInputElement).value).toBe('GB-TAX-2');
    expect(screen.queryByTestId('payment-instructions')).toBeNull();
  });

  it('a roster artist gets names only — no legal fields, no payee block, no buttons', async () => {
    responder = () => ({
      status: 200,
      body: payload({ parties: [{ id: 'p1', kind: 'person', displayName: 'Nova', contactId: null }], canWrite: false, canSeePayee: false, members: undefined }),
    });
    render(<PartiesView orgId="o1" />);
    const editor = await open('Nova');
    expect(screen.queryByTestId('legal-name')).toBeNull();
    expect(screen.queryByTestId('party-payee')).toBeNull();
    expect(screen.queryByTestId('party-save')).toBeNull();
    expect(screen.queryByTestId('party-new')).toBeNull();
    expect(within(editor).getByTestId('party-names-only')).toBeTruthy();
    expect((screen.getByTestId('display-name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('party-unconfirmed')).toBeNull(); // not told either way
  });

  it('finance reads the payee block, read-only, and the person list without legal data', async () => {
    responder = () => ({
      status: 200,
      body: payload({ parties: [party({ legal: undefined, linkedUserId: undefined })], canWrite: false, canSeePayee: true, members: undefined }),
    });
    render(<PartiesView orgId="o1" />);
    const editor = await open('Nova');
    expect(screen.queryByTestId('legal-name')).toBeNull();
    expect((within(editor).getByTestId('tax-id') as HTMLInputElement).disabled).toBe(true);
    expect((within(editor).getByTestId('payment-instructions') as HTMLTextAreaElement).value).toBe('Invoice monthly');
    expect(screen.queryByTestId('party-save')).toBeNull();
  });

  it('search finds by legal name or country, never by tax id', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await screen.findAllByTestId('party-row');
    fireEvent.change(screen.getByTestId('parties-search'), { target: { value: 'ascap fr' } });
    expect(screen.getAllByTestId('party-row').map((r) => r.textContent)).toHaveLength(1);
    fireEvent.change(screen.getByTestId('parties-search'), { target: { value: 'GB-TAX-2' } });
    expect(screen.getByTestId('parties-empty')).toBeTruthy();
  });

  it('says so when the migrations are missing, and offers a retry on a failed load', async () => {
    responder = () => ({ status: 200, body: payload({ schemaReady: false, parties: [] }) });
    render(<PartiesView orgId="o1" />);
    expect(await screen.findByTestId('parties-not-ready')).toBeTruthy();
    cleanup();
    responder = () => ({ status: 500, body: { error: 'Could not load the parties' } });
    render(<PartiesView orgId="o1" />);
    expect((await screen.findByTestId('parties-failed')).textContent).toContain('Could not load the parties');
  });
});

describe('PartiesView — saving', () => {
  it('sends only the changed fields, so an untouched name never trips the lock', async () => {
    responder = (c) => (c.method === 'PATCH' ? { status: 200, body: { party: party({ legal: legal({ address: '9 new road' }) }) } } : { status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.change(screen.getByTestId('address'), { target: { value: '9 new road' } });
    fireEvent.click(screen.getByTestId('party-save'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ url: '/api/org/o1/parties/p1', method: 'PATCH', body: { address: '9 new road' } });
    await waitFor(() => expect(toasts()).toContain('success:Party saved'));
  });

  it('refuses an IBAN in the payment instructions before sending anything, in plain words', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.change(screen.getByTestId('payment-instructions'), { target: { value: 'GB29 NWBK 6016 1331 9268 19' } });
    fireEvent.click(screen.getByTestId('party-save'));
    expect((await screen.findByTestId('party-error')).textContent).toMatch(/cannot hold a bank or card number/i);
    expect(writes()).toEqual([]);
  });

  it('shows the lock’s reason under the form when the server refuses a rename (409)', async () => {
    responder = (c) =>
      c.method === 'PATCH'
        ? { status: 409, body: { error: 'This name is on a split sheet that has been circulated. Start a new version of the sheet with a new party instead of renaming this one.', code: 'party_locked' } }
        : { status: 200, body: payload() };
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.change(screen.getByTestId('display-name'), { target: { value: 'Nova O' } });
    fireEvent.click(screen.getByTestId('party-save'));
    expect((await screen.findByTestId('party-error')).textContent).toMatch(/circulated/);
    expect(writes()[0].body).toEqual({ display_name: 'Nova O' });
  });

  it('says nothing changed instead of sending an empty edit', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.click(screen.getByTestId('party-save'));
    expect((await screen.findByTestId('party-error')).textContent).toBe('Nothing has changed.');
    expect(writes()).toEqual([]);
  });

  it('adds a party with only what was typed', async () => {
    responder = (c) => (c.method === 'POST' ? { status: 201, body: { party: party({ id: 'p9', displayName: 'Odile' }) } } : { status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    fireEvent.click(await screen.findByTestId('party-new'));
    fireEvent.change(screen.getByTestId('display-name'), { target: { value: 'Odile' } });
    fireEvent.change(screen.getByTestId('country'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByTestId('party-save'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ url: '/api/org/o1/parties', method: 'POST', body: { display_name: 'Odile', country: 'fr' } });
    await waitFor(() => expect(screen.getAllByTestId('party-row').some((r) => r.textContent?.includes('Odile'))).toBe(true));
  });

  it('a new party needs a name', async () => {
    responder = () => ({ status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    fireEvent.click(await screen.findByTestId('party-new'));
    fireEvent.click(screen.getByTestId('party-save'));
    expect((await screen.findByTestId('party-error')).textContent).toMatch(/needs a name/i);
    expect(writes()).toEqual([]);
  });
});

describe('PartiesView — confirming', () => {
  it('the person confirms their own details, correcting only legal fields', async () => {
    const mine = party({ mine: true, payee: undefined, linkedUserId: undefined });
    responder = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { party: party({ mine: true, payee: undefined, linkedUserId: undefined, legal: legal({ ipi: '00123456780', confirmedAt: '2026-10-02T10:00:00Z' }) }) } }
        : { status: 200, body: payload({ parties: [mine], canWrite: false, canSeePayee: false, members: undefined }) };
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    expect(screen.queryByTestId('party-save')).toBeNull();
    expect((screen.getByTestId('display-name') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('ipi'), { target: { value: '00123456780' } });
    fireEvent.click(screen.getByTestId('party-confirm'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ url: '/api/org/o1/parties/p1/confirm', method: 'POST', body: { ipi: '00123456780' } });
    await waitFor(() => expect(toasts()).toContain('success:Details confirmed'));
    expect(await screen.findByTestId('party-confirmed')).toBeTruthy();
  });

  it('a writer can ask the linked person to confirm; a party with no account or already confirmed has no button', async () => {
    responder = (c) => (c.method === 'POST' ? { status: 200, body: { asked: true } } : { status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.click(screen.getByTestId('party-invite'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/org/o1/parties/p1/invite', method: 'POST' });
    await waitFor(() => expect(toasts()).toContain('success:Asked to confirm'));
    await open('Kilo'); // no linked account
    expect(screen.queryByTestId('party-invite')).toBeNull();
  });
});

describe('PartiesView — deleting', () => {
  it('asks first, then deletes; a refusal (a party on credits) is shown', async () => {
    responder = (c) => (c.method === 'DELETE' ? { status: 409, body: { error: 'This party is named on 1 credit or split-sheet line', credits: 1 } } : { status: 200, body: payload() });
    render(<PartiesView orgId="o1" />);
    await open('Nova');
    fireEvent.click(screen.getByTestId('party-delete'));
    expect(writes()).toEqual([]);
    useToastStore.getState().toasts.find((t) => t.title === 'Delete this party?')!.actions!.find((a) => a.label === 'Delete')!.onClick();
    expect((await screen.findByTestId('party-error')).textContent).toContain('named on 1 credit');
    expect(screen.getAllByTestId('party-row')).toHaveLength(2);
  });
});
