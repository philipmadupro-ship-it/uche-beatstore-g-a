// @vitest-environment jsdom

/**
 * The owner's settings screen (LABEL-51): it sends only what changed, asks
 * before skipping legal approval, shows what the licence lacks, and says so
 * plainly to anyone refused. The rules are the server's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrgSettingsPanel } from './OrgSettingsPanel';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirmToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast }));

const DEFAULTS = { legal_gate: 'on', marketing_gate: 'on', require_signed_master_split: false, attention_release_days: 30, attention_stalled_days: 30, departments_off: [] };
let calls: { url: string; method: string; body: unknown }[];
let getReply: { status: number; body: unknown };
let patchReply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  getReply = { status: 200, body: { settings: DEFAULTS, licensed: ['finance', 'store', 'export'], switchable: ['finance', 'store'] } };
  patchReply = { status: 200, body: { settings: { ...DEFAULTS, marketing_gate: 'off' }, licensed: ['finance', 'store', 'export'], switchable: ['finance', 'store'], changed: ['marketing_gate'] } };
  confirmToast.mockReset();
  toast.success.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = method === 'GET' ? getReply : patchReply;
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const save = () => screen.getByRole('button', { name: /save settings/i });

describe('OrgSettingsPanel', () => {
  it('saves nothing until something changed, then sends only that key', async () => {
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/require marketing approval/i));
    await waitFor(() => expect((save() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([{ url: '/api/org/o1/settings', method: 'PATCH', body: { marketing_gate: 'off' } }]);
    expect(confirmToast).not.toHaveBeenCalled();
  });

  it('asks before skipping legal approval, and sends nothing when the owner declines', async () => {
    confirmToast.mockResolvedValue(false);
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    fireEvent.click(screen.getByLabelText(/require legal approval/i));
    fireEvent.click(save());
    await waitFor(() => expect(confirmToast).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('switches a department off, in MODULES order, and lists what the licence lacks', async () => {
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    fireEvent.click(screen.getByLabelText(/^store listing/i));
    fireEvent.click(screen.getByLabelText(/^finance/i));
    fireEvent.click(save());
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ departments_off: ['finance', 'store'] });
    expect(screen.getByTestId('unlicensed').textContent).toMatch(/Contracts & legal/);
    expect(screen.queryByLabelText(/^data export/i)).toBeNull();
  });

  it('refuses day counts outside 1..365 before sending', async () => {
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    fireEvent.change(screen.getByLabelText(/release target within/i), { target: { value: '0' } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/release target within/i), { target: { value: '14' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ attention_release_days: 14 });
  });

  it('shows the server’s words when the save is refused', async () => {
    patchReply = { status: 422, body: { error: 'pr is not part of this organization\'s licence.' } };
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    fireEvent.click(screen.getByLabelText(/require marketing approval/i));
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toMatch(/licence/);
  });

  it('tells a non-owner plainly (403) instead of drawing the form', async () => {
    getReply = { status: 403, body: { error: 'Forbidden' } };
    render(<OrgSettingsPanel orgId="o1" />);
    expect((await screen.findByTestId('settings-denied')).textContent).toMatch(/Only the owner/);
    expect(screen.queryByTestId('org-settings')).toBeNull();
  });

  it('blocks Save and says why when Contracts is off while legal approval is still required', async () => {
    getReply = { status: 200, body: { settings: { ...DEFAULTS, departments_off: ['contracts'] }, licensed: ['contracts', 'export'], switchable: ['contracts'] } };
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    expect(screen.getByTestId('contracts-legal-warning').textContent).toMatch(/legal approval/i);
    fireEvent.click(screen.getByLabelText(/require marketing approval/i));
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a department that is off but no longer licensed visible, so it can be cleared', async () => {
    getReply = { status: 200, body: { settings: { ...DEFAULTS, departments_off: ['marketing'] }, licensed: ['export'], switchable: [] } };
    render(<OrgSettingsPanel orgId="o1" />);
    await screen.findByTestId('org-settings');
    const box = screen.getByLabelText(/^marketing/i) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getAllByText(/not in your licence/i).length).toBeGreaterThan(0);
  });
});
