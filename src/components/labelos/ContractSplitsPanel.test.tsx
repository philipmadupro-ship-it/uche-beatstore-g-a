// @vitest-environment jsdom

/**
 * The contract's split sheet panel (LABEL-59): what the contract states per
 * kind, the pre-fill button, the two-step replace of an existing draft, and
 * the drift notice — itemised for rights.read, a bare sentence for anyone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useToastStore } from '@/hooks/useToast';
import type { ContractSplitsPayload } from '@/lib/labelos/contract-splits-client';
import { ContractSplitsPanel } from './ContractSplitsPanel';
import { DriftNotice } from './DriftNotice';

const payload = (over: Partial<ContractSplitsPayload> = {}): ContractSplitsPayload => ({
  schemaReady: true,
  applicable: true,
  kinds: [{ key: 'master', label: 'Master' }, { key: 'composition', label: 'Composition' }],
  plans: [
    { kind: 'master', ok: true, incomplete: false, lines: [{ partyId: 'f', name: 'Feat Person', role: 'master_owner', roleLabel: 'Master owner', share: '30' }, { partyId: 'n', name: 'Nova Okafor', role: 'master_owner', roleLabel: 'Master owner', share: '70' }] },
    { kind: 'composition', ok: false, reason: 'field_missing', message: 'The contract does not state the share yet.' },
  ],
  drift: [],
  canPrefill: true,
  drafts: {},
  ...over,
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let responder: (call: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  useToastStore.setState({ toasts: [] });
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

const mount = () => render(<ContractSplitsPanel orgId="o1" contractId="c1" trackId="t1" version={1} />);

describe('ContractSplitsPanel', () => {
  it('shows what the contract states per kind, and why a kind cannot be filled', async () => {
    responder = () => ({ status: 200, body: payload() });
    mount();
    expect((await screen.findByTestId('contract-split-plan-master')).textContent).toContain('Feat Person');
    expect(screen.getByTestId('contract-split-plan-master').textContent).toContain('30%');
    expect(screen.getByTestId('contract-split-skip-composition').textContent).toContain('does not state the share');
  });

  it('draws nothing for a contract type that states no split, or before the migrations', async () => {
    responder = () => ({ status: 200, body: payload({ applicable: false, plans: [] }) });
    const { container } = mount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.innerHTML).toBe('');
    cleanup();
    responder = () => ({ status: 200, body: { schemaReady: false } });
    const again = mount();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(again.container.innerHTML).toBe('');
  });

  it('pre-fills a draft without replace_draft', async () => {
    responder = (c) => (c.method === 'POST' ? { status: 200, body: { results: [{ kind: 'master', action: 'created', sheetId: 's1' }] } } : { status: 200, body: payload() });
    mount();
    fireEvent.click(await screen.findByTestId('contract-splits-prefill'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({});
  });

  it('an existing draft is never replaced without a second, explicit click', async () => {
    responder = (c) => {
      if (c.method === 'GET') return { status: 200, body: payload({ drafts: { master: true } }) };
      return c.body && (c.body as { replace_draft?: boolean }).replace_draft
        ? { status: 200, body: { results: [{ kind: 'master', action: 'replaced', sheetId: 's1' }] } }
        : { status: 409, body: { error: 'There is already a draft split sheet for this song.' } };
    };
    mount();
    fireEvent.click(await screen.findByTestId('contract-splits-prefill'));
    expect(await screen.findByTestId('contract-splits-confirm')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('contract-splits-replace'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ replace_draft: true });
  });

  it('no button for someone who cannot pre-fill', async () => {
    responder = () => ({ status: 200, body: payload({ canPrefill: false }) });
    mount();
    await screen.findByTestId('contract-split-plan-master');
    expect(screen.queryByTestId('contract-splits-prefill')).toBeNull();
  });

  it('a drift warning on the contract: itemised when the server sent the items', async () => {
    responder = () => ({
      status: 200,
      body: payload({ drift: [{ kind: 'master', drifted: true, sheetId: 's1', items: [{ partyId: 'f', name: 'Feat', code: 'differs', contract: '30', sheet: '25' }] }] }),
    });
    mount();
    expect((await screen.findByTestId('drift-master')).textContent).toContain('differs from this contract');
    expect(screen.getByTestId('drift-master-items').textContent).toContain('Feat: contract 30%, sheet 25%');
  });
});

describe('DriftNotice', () => {
  it('without items (D2) it is only the sentence: no name, no share', () => {
    render(<DriftNotice entry={{ kind: 'composition', drifted: true, sheetId: 's1' }} against="its contract “Deal”" />);
    expect(screen.getByTestId('drift-composition').textContent).toContain('differs from its contract “Deal”');
    expect(screen.queryByTestId('drift-composition-items')).toBeNull();
  });
  it('is absent when nothing drifted', () => {
    const { container } = render(<DriftNotice entry={{ kind: 'master', drifted: false, sheetId: 's1' }} against="x" />);
    expect(container.innerHTML).toBe('');
  });
  it('names a party that is missing from the sheet', () => {
    render(<DriftNotice entry={{ kind: 'master', drifted: true, sheetId: 's', items: [{ partyId: 'p', name: 'Kilo', code: 'missing', contract: '10', sheet: null }] }} against="its contract" />);
    expect(screen.getByTestId('drift-master-items').textContent).toContain('Kilo: contract 10%, not on the sheet');
  });
});
