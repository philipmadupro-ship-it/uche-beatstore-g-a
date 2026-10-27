// @vitest-environment jsdom

/**
 * The split sheet panel (LABEL-28): the sum shown LIVE while typing, Circulate
 * held back (with the reason) until it is exactly 100, "Add remainder" filling
 * what is missing, a circulated sheet drawn read-only with each signature, the
 * own-line view that shows one line and nothing else, and no section at all
 * for a member with no rights ability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import type { SplitsPayload } from '@/lib/labelos/splits-client';
import type { SplitLineView, SplitSheetView } from '@/lib/labelos/splits';
import { OrgSplits } from './OrgSplits';

const line = (over: Partial<SplitLineView> = {}): SplitLineView => ({
  id: 'l1', partyId: 'pa', name: 'Nova', role: 'writer', roleLabel: 'Writer', units: 333_333, share: '33.3333', mine: false,
  signed: false, signedAt: null, signatureMethod: null, can: { acknowledge: false, uploadSigned: false }, ...over,
});
const sheet = (over: Partial<SplitSheetView> = {}): SplitSheetView => ({
  id: 's1', trackId: 't1', kind: 'composition', version: 1, status: 'draft', statusLabel: 'Draft', note: null, createdAt: '2026-10-01',
  circulatedAt: null, signedAt: null, supersededAt: null, hasDocument: false, total: '99.9999', signedCount: 0, lineCount: 3,
  lines: [line({ id: 'l1', partyId: 'pa', name: 'Nova' }), line({ id: 'l2', partyId: 'pb', name: 'Pierre' }), line({ id: 'l3', partyId: 'pc', name: 'Kilo' })],
  can: { edit: true, circulate: true, supersede: false },
  ...over,
});
const kinds: SplitsPayload['kinds'] = [
  { key: 'composition', label: 'Composition', roles: [{ key: 'writer', label: 'Writer' }, { key: 'composer', label: 'Composer' }, { key: 'writer_composer', label: 'Writer & composer' }, { key: 'publisher', label: 'Publisher' }] },
  { key: 'master', label: 'Master', roles: [{ key: 'master_owner', label: 'Master owner' }] },
];
const payload = (sheets: SplitSheetView[], over: Partial<SplitsPayload> = {}): SplitsPayload => ({
  schemaReady: true, sheets, me: { reach: 'all', canWrite: true }, kinds, ...over,
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let responder: (call: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method: init?.method ?? 'GET', body };
    calls.push(call);
    const { status, body: out } = responder(call);
    return { ok: status < 400, status, json: async () => out } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toasts = () => useToastStore.getState().toasts.map((t) => `${t.kind}:${t.title}`);
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/parties'));

function serve(initial: SplitsPayload, extra: (c: Call) => { status: number; body: unknown } | null = () => null) {
  responder = (c) => {
    const custom = extra(c);
    if (custom) return custom;
    if (c.url.endsWith('/parties')) return { status: 200, body: { parties: [] } };
    return { status: 200, body: initial };
  };
}

describe('OrgSplits — the draft form', () => {
  it('33.3333 × 3 reads 99.9999%, says what is unassigned, and Circulate is held back with the reason', async () => {
    serve(payload([sheet()]));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const total = await screen.findByTestId('splits-total');
    expect(total.textContent).toContain('99.9999%');
    expect(total.textContent).toContain('0.0001% unassigned.');
    expect(total.getAttribute('data-tone')).toBe('short');
    const circulate = screen.getByTestId('splits-circulate') as HTMLButtonElement;
    expect(circulate.disabled).toBe(true);
    expect(circulate.title).toBe('The shares add up to 99.9999%; 0.0001% is still unassigned.');
    expect(screen.getByTestId('splits-blocker').textContent).toContain('0.0001% is still unassigned');
  });

  it('typing updates the sum as you go, exactly: 33.3334 + 33.3333 + 33.3333 is 100% and Circulate wakes up', async () => {
    serve(payload([sheet()]));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const shares = await screen.findAllByTestId('splits-share');
    fireEvent.change(shares[0], { target: { value: '33.3334' } });
    const total = screen.getByTestId('splits-total');
    expect(total.textContent).toContain('100%');
    expect(total.getAttribute('data-tone')).toBe('ok');
    expect((screen.getByTestId('splits-circulate') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(shares[1], { target: { value: '40' } });
    expect(screen.getByTestId('splits-total').textContent).toContain('6.6667% too much.');
    expect(screen.getByTestId('splits-total').getAttribute('data-tone')).toBe('over');
    expect((screen.getByTestId('splits-circulate') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Add remainder gives the missing share to a blank row, or adds a row', async () => {
    serve(payload([sheet()]));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-draft');
    fireEvent.click(screen.getByTestId('splits-add-remainder'));
    const shares = screen.getAllByTestId('splits-share') as HTMLInputElement[];
    expect(shares.map((s) => s.value)).toEqual(['33.3333', '33.3333', '33.3333', '0.0001']);
    expect(screen.getByTestId('splits-total').textContent).toContain('100%');
    expect((screen.getByTestId('splits-add-remainder') as HTMLButtonElement).disabled).toBe(true);
    // The new row has no person yet, so the sheet still cannot circulate.
    expect(screen.getByTestId('splits-blocker').textContent).toBe('Every line needs a person.');
  });

  it('a share that is not a share is flagged and blocks saving and circulating', async () => {
    serve(payload([sheet()]));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const shares = (await screen.findAllByTestId('splits-share')) as HTMLInputElement[];
    fireEvent.change(shares[0], { target: { value: '33.33333' } });
    expect(shares[0].getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByTestId('splits-circulate') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('splits-save'));
    await waitFor(() => expect(toasts()).toContain('error:Every line needs a share: more than 0, up to four decimals.'));
    expect(writes()).toEqual([]);
  });

  it('Save sends the rows (shares as typed) and Circulate saves first, then circulates', async () => {
    const full = sheet({ total: '100', lines: [line({ id: 'l1', share: '33.3334', partyId: 'pa' }), line({ id: 'l2', partyId: 'pb', name: 'Pierre' }), line({ id: 'l3', partyId: 'pc', name: 'Kilo' })] });
    serve(payload([sheet()]), (c) => {
      if (c.method === 'PATCH') return { status: 200, body: { sheet: full } };
      if (c.url.endsWith('/circulate')) return { status: 200, body: { sheet: { ...full, status: 'circulated', statusLabel: 'Circulated' }, supersededId: null } };
      return null;
    });
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const shares = await screen.findAllByTestId('splits-share');
    fireEvent.change(shares[0], { target: { value: '33.3334' } });
    fireEvent.click(screen.getByTestId('splits-circulate'));
    await waitFor(() => expect(writes().map((w) => `${w.method} ${w.url.replace('/api/org/o1/tracks/t1/splits', '')}`)).toEqual(['PATCH /s1', 'POST /s1/circulate']));
    expect(writes()[0].body).toEqual({
      lines: [
        { party_id: 'pa', role: 'writer', share: '33.3334' },
        { party_id: 'pb', role: 'writer', share: '33.3333' },
        { party_id: 'pc', role: 'writer', share: '33.3333' },
      ],
    });
    await waitFor(() => expect(toasts()).toContain('success:Circulated for signature'));
  });

  it('the server’s own words are shown when it refuses', async () => {
    serve(payload([sheet({ lines: [line({ id: 'l1', share: '100' })] })]), (c) => (c.url.endsWith('/circulate') ? { status: 422, body: { error: 'Add at least one line.' } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-draft');
    fireEvent.click(screen.getByTestId('splits-circulate'));
    await waitFor(() => expect(toasts()).toContain('error:Add at least one line.'));
  });

  it('Discard draft calls DELETE', async () => {
    serve(payload([sheet()]), (c) => (c.method === 'DELETE' ? { status: 200, body: { deleted: true } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-draft');
    fireEvent.click(screen.getByTestId('splits-discard'));
    await waitFor(() => expect(writes().map((w) => w.method)).toEqual(['DELETE']));
  });
});

describe('OrgSplits — empty and tabs', () => {
  it('no sheet yet: a rights writer can start one; the other kind is its own tab', async () => {
    serve(payload([]), (c) => (c.method === 'POST' ? { status: 201, body: { sheet: sheet({ lines: [], total: '0' }) } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    expect((await screen.findByText('No composition split sheet yet.')).textContent).toBeTruthy();
    fireEvent.click(screen.getByTestId('splits-tab-master'));
    expect(screen.getByText('No master split sheet yet.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('splits-start'));
    await waitFor(() => expect(writes()).toEqual([{ url: '/api/org/o1/tracks/t1/splits', method: 'POST', body: { kind: 'master' } }]));
  });

  it('a reader without write rights is offered no way to start one', async () => {
    serve(payload([], { me: { reach: 'all', canWrite: false } }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByText('No composition split sheet yet.');
    expect(screen.queryByTestId('splits-start')).toBeNull();
  });

  it('nothing at all when migration 155 is missing or the member has no rights ability', async () => {
    serve(payload([], { schemaReady: false }));
    const { container, unmount } = render(<OrgSplits orgId="o1" trackId="t1" />);
    await waitFor(() => expect(container.querySelector('[data-testid="org-splits-loading"]')).toBeNull());
    expect(screen.queryByTestId('org-splits')).toBeNull();
    unmount();
    responder = () => ({ status: 403, body: { error: 'Forbidden' } });
    const second = render(<OrgSplits orgId="o1" trackId="t1" />);
    await waitFor(() => expect(second.container.querySelector('[data-testid="org-splits-loading"]')).toBeNull());
    expect(screen.queryByTestId('org-splits')).toBeNull();
  });
});

describe('OrgSplits — a circulated sheet', () => {
  const live = sheet({
    status: 'circulated', statusLabel: 'Circulated', total: '100', signedCount: 1, lineCount: 3, can: { edit: false, circulate: false, supersede: true },
    lines: [
      line({ id: 'l1', name: 'Nova', share: '33.3334', signed: true, signatureMethod: 'acknowledged', legalName: 'Nova Okafor', ipi: '00987654321' }),
      line({ id: 'l2', name: 'Pierre', share: '33.3333', mine: true, can: { acknowledge: true, uploadSigned: true } }),
      line({ id: 'l3', name: 'Kilo', share: '33.3333', can: { acknowledge: false, uploadSigned: true } }),
    ],
  });

  it('is read-only, shows each signature and the progress, and the legal data the server sent', async () => {
    serve(payload([live]));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const box = await screen.findByTestId('splits-sheet');
    expect(screen.queryByTestId('splits-draft')).toBeNull();
    expect(screen.queryByTestId('splits-share')).toBeNull();
    expect(screen.getByTestId('splits-status').textContent).toBe('Circulated');
    expect(screen.getByTestId('splits-progress').textContent).toBe('1 of 3 signed');
    const rows = screen.getAllByTestId('splits-line');
    expect(within(rows[0]).getByTestId('splits-signed').textContent).toBe('acknowledged');
    expect(rows[0].textContent).toContain('Nova Okafor · IPI 00987654321');
    expect(rows[1].textContent).toContain('you');
    expect(box.textContent).toContain('100%');
  });

  it('Acknowledge is offered on the viewer’s own line only, and posts that line', async () => {
    const after = { ...live, signedCount: 2, lines: live.lines.map((l) => (l.id === 'l2' ? { ...l, signed: true, signatureMethod: 'acknowledged' as const, can: { acknowledge: false, uploadSigned: false } } : l)) };
    serve(payload([live]), (c) => (c.url.endsWith('/signatures') ? { status: 200, body: { sheet: after, complete: false } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-sheet');
    const buttons = screen.getAllByTestId('splits-acknowledge');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(writes()).toEqual([{ url: '/api/org/o1/tracks/t1/splits/s1/signatures', method: 'POST', body: { method: 'acknowledged', line_id: 'l2' } }]));
    await waitFor(() => expect(screen.getByTestId('splits-progress').textContent).toBe('2 of 3 signed'));
    expect(screen.queryByTestId('splits-acknowledge')).toBeNull();
  });

  it('a signed PDF goes up as multipart with the line it is for; the whole-sheet button sends none', async () => {
    serve(payload([live]), (c) => (c.url.endsWith('/signatures') ? { status: 200, body: { sheet: live, complete: false } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-sheet');
    const input = screen.getByTestId('splits-file') as HTMLInputElement;
    const pdf = new File([new Uint8Array(8)], 'signed.pdf', { type: 'application/pdf' });

    fireEvent.click(screen.getAllByTestId('splits-upload-line')[1]);
    fireEvent.change(input, { target: { files: [pdf] } });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ line_id: 'l3' });
    // Let the first upload settle: the whole-sheet button is disabled while busy, and a click on it then does
    // nothing — so the next file would still be filed under the previous line (a race, seen once in CI).
    await waitFor(() => expect((screen.getByTestId('splits-upload') as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByTestId('splits-upload'));
    fireEvent.change(input, { target: { files: [pdf] } });
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).not.toHaveProperty('line_id');
    expect((writes()[1].body as { file: File }).file.name).toBe('signed.pdf');
  });

  it('New version starts the next draft and shows it', async () => {
    const v2 = sheet({ id: 's2', version: 2, total: '100' });
    serve(payload([live]), (c) => (c.url.endsWith('/supersede') ? { status: 201, body: { sheet: v2 } } : null));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-sheet');
    fireEvent.click(screen.getByTestId('splits-new-version'));
    await waitFor(() => expect(screen.getByTestId('splits-draft').getAttribute('data-version')).toBe('2'));
    expect(screen.getByTestId('splits-versions').textContent).toContain('v1');
  });

  it('a reader without write rights gets no New version and no whole-sheet upload', async () => {
    serve(payload([{ ...live, can: { edit: false, circulate: false, supersede: false }, lines: live.lines.map((l) => ({ ...l, can: { acknowledge: false, uploadSigned: false } })) }], { me: { reach: 'all', canWrite: false } }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('splits-sheet');
    for (const id of ['splits-new-version', 'splits-upload', 'splits-acknowledge', 'splits-upload-line']) expect(screen.queryByTestId(id), id).toBeNull();
  });
});

describe('OrgSplits — own line only (D2)', () => {
  it('shows the one line and nothing of the sheet beyond it: no total, no count, no other name', async () => {
    const own: SplitSheetView = sheet({
      status: 'circulated', statusLabel: 'Circulated', total: undefined, signedCount: undefined, lineCount: undefined, can: { edit: false, circulate: false, supersede: false },
      lines: [line({ id: 'l2', name: 'Pierre', share: '33.3333', mine: true, can: { acknowledge: true, uploadSigned: false } })],
    });
    serve(payload([own], { me: { reach: 'own', canWrite: false } }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    const box = await screen.findByTestId('splits-sheet');
    expect(screen.getAllByTestId('splits-line')).toHaveLength(1);
    expect(box.textContent).not.toContain('Nova');
    expect(screen.queryByTestId('splits-total')).toBeNull();
    expect(screen.queryByTestId('splits-progress')).toBeNull();
    expect(screen.getByTestId('splits-acknowledge')).toBeTruthy();
  });

  it('an own-line member with nothing circulated yet sees no section', async () => {
    serve(payload([], { me: { reach: 'own', canWrite: false } }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await waitFor(() => expect(screen.queryByTestId('org-splits-loading')).toBeNull());
    expect(screen.queryByTestId('org-splits')).toBeNull();
  });
});

describe('OrgSplits — drift against a contract (LABEL-59)', () => {
  const circulated = (over: Partial<SplitSheetView> = {}) =>
    sheet({ id: 's9', kind: 'composition', status: 'circulated', statusLabel: 'Circulated', total: '100', can: { edit: false, circulate: false, supersede: true }, ...over });

  it('warns on the sheet that differs from its contract, with the contract linked', async () => {
    serve(payload([circulated()], { contracts: [{ contractId: 'c1', title: 'Feature deal', status: 'sent', type: 'feature', drift: [{ kind: 'composition', drifted: true, sheetId: 's9', items: [{ partyId: 'pa', name: 'Nova', code: 'differs', contract: '10', sheet: '12.5' }] }] }] }));
    render(<OrgSplits orgId="o1" orgSlug="acme" trackId="t1" />);
    const notice = await screen.findByTestId('drift-composition');
    expect(notice.textContent).toContain('differs from its contract “Feature deal”');
    expect(screen.getByTestId('drift-composition-items').textContent).toContain('Nova: contract 10%, sheet 12.5%');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/o/acme/rights/contracts/c1');
  });

  it('D2: for an own-line reader it is only the sentence', async () => {
    serve(payload([circulated({ total: undefined, can: { edit: false, circulate: false, supersede: false } })], {
      me: { reach: 'own', canWrite: false },
      contracts: [{ contractId: 'c1', title: 'Feature deal', status: 'sent', type: 'feature', drift: [{ kind: 'composition', drifted: true, sheetId: 's9' }] }],
    }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    expect((await screen.findByTestId('drift-composition')).textContent).toContain('differs from its contract');
    expect(screen.queryByTestId('drift-composition-items')).toBeNull();
  });

  it('no warning when the sheet matches, or when the drift belongs to another sheet', async () => {
    serve(payload([circulated()], { contracts: [{ contractId: 'c1', title: 'Feature deal', status: 'sent', type: 'feature', drift: [{ kind: 'composition', drifted: false, sheetId: 's9' }, { kind: 'composition', drifted: true, sheetId: 'other' }] }] }));
    render(<OrgSplits orgId="o1" trackId="t1" />);
    await screen.findByTestId('org-splits');
    expect(screen.queryByTestId('drift-composition')).toBeNull();
  });
});
