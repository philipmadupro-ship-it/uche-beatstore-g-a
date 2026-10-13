// @vitest-environment jsdom

/**
 * The approval control of a song (LABEL-30): Frame.io's words, the stale state
 * with what changed, who is shown which buttons, and nothing at all when the
 * route says no. The rules are the server's (approvals.test.ts, the route
 * test); here only what is drawn from what was sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrgApprovals, changedText } from './OrgApprovals';
import type { GateStateView } from '@/lib/labelos/approvals-client';

const SONG = '50000000-0000-4000-8000-000000000001';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

const gate = (over: Partial<GateStateView> = {}): GateStateView => ({
  gate: 'legal',
  label: 'Legal',
  status: 'none',
  stale: false,
  changed: [],
  chip: { label: 'Not requested', tone: 'neutral' },
  decision: null,
  pending: null,
  canDecide: false,
  selfApprovalBlocked: false,
  canRequest: false,
  approvers: [],
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: 'r1', gate: 'legal', decision: 'approved', note: null, at: '2026-10-05T10:00:00Z', by: 'Lena Legal', approver: null, approverId: null, ...over });

let calls: { url: string; init?: RequestInit }[];
let reply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
  });
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (g: GateStateView) => {
  reply = { status: 200, body: { schemaReady: true, gates: [g] } };
  return render(<OrgApprovals orgId="org1" trackId={SONG} />);
};

describe('states', () => {
  it('Not requested: the chip, and an Ask button only for someone who may ask and has someone to ask', async () => {
    mount(gate({ canRequest: true, approvers: [{ userId: 'u1', name: 'Lena Legal' }] }));
    expect((await screen.findByTestId('org-approval-chip-legal')).textContent).toContain('Not requested');
    expect(screen.getByTestId('org-approval-ask').textContent).toContain('Ask for approval');
    expect(calls[0].url).toBe(`/api/org/org1/approvals?song=${SONG}`);
  });

  it('nobody to ask → no Ask button; cannot ask → none either; and no decide buttons without the gate', async () => {
    mount(gate({ canRequest: true, approvers: [] }));
    await screen.findByTestId('org-approval-chip-legal');
    expect(screen.queryByTestId('org-approval-ask')).toBeNull();
    expect(screen.queryByTestId('org-approval-approve')).toBeNull();
  });

  it('Approved shows who, when and the note', async () => {
    mount(gate({ status: 'approved', chip: { label: 'Approved', tone: 'good' }, decision: row({ note: 'Splits look right' }) as never }));
    expect((await screen.findByTestId('org-approval-chip-legal')).textContent).toContain('Approved');
    expect(screen.getByTestId('org-approval-decision').textContent).toContain('Approved by Lena Legal');
    expect(screen.getByTestId('org-approval-decision').textContent).toContain('“Splits look right”');
    expect(screen.getByTestId('org-approval-chip-legal').getAttribute('data-stale')).toBe('false');
  });

  it('Changes requested shows the note', async () => {
    mount(gate({ status: 'changes_requested', chip: { label: 'Changes requested', tone: 'warn' }, decision: row({ decision: 'changes_requested', note: 'Nova needs an IPI' }) as never }));
    expect((await screen.findByTestId('org-approval-chip-legal')).textContent).toContain('Changes requested');
    expect(screen.getByTestId('org-approval-decision').textContent).toContain('“Nova needs an IPI”');
  });

  it('a stale approval says "Stale — changed since approval" and what changed', async () => {
    mount(gate({ status: 'approved', stale: true, changed: ['songs'], chip: { label: 'Stale — changed since approval', tone: 'warn' }, decision: row() as never, canRequest: true, approvers: [{ userId: 'u1', name: 'Lena' }] }));
    const chip = await screen.findByTestId('org-approval-chip-legal');
    expect(chip.textContent).toContain('Stale — changed since approval');
    expect(chip.getAttribute('data-stale')).toBe('true');
    expect(screen.getByTestId('org-approval-stale').textContent).toContain('splits or credits changed after Lena Legal approved it');
    // Not the "Approved by …" line: that would read as still good.
    expect(screen.queryByTestId('org-approval-decision')).toBeNull();
    expect(screen.getByTestId('org-approval-ask').textContent).toContain('Ask again');
  });

  it('awaiting: who was asked and by whom', async () => {
    mount(gate({ status: 'requested', chip: { label: 'Awaiting approval', tone: 'waiting' }, pending: row({ decision: 'requested', by: 'Ari A&R', approver: 'Lena Legal', note: 'please check' }) as never, canRequest: true, approvers: [{ userId: 'u1', name: 'Lena' }] }));
    expect((await screen.findByTestId('org-approval-pending')).textContent).toContain('Asked of Lena Legal by Ari A&R');
    expect(screen.queryByTestId('org-approval-ask')).toBeNull(); // one open request at a time
  });

  it('hidden when the route refuses, is not set up, or has nothing', async () => {
    for (const r of [{ status: 403, body: { error: 'Forbidden' } }, { status: 200, body: { schemaReady: false, gates: [] } }, { status: 200, body: { schemaReady: true, gates: [] } }]) {
      reply = r;
      const { container, unmount } = render(<OrgApprovals orgId="org1" trackId={SONG} />);
      await waitFor(() => expect(container.querySelector('[data-testid="org-approvals-loading"]')).toBeNull());
      expect(container.querySelector('[data-testid="org-approvals"]')).toBeNull();
      unmount();
    }
  });
});

describe('deciding', () => {
  const decider = (over: Partial<GateStateView> = {}) =>
    gate({ canDecide: true, status: 'requested', chip: { label: 'Awaiting approval', tone: 'waiting' }, pending: row({ decision: 'requested', approver: 'Lena Legal' }) as never, ...over });

  it('Approve posts the decision and shows the new state with a toast', async () => {
    mount(decider());
    const approve = await screen.findByTestId('org-approval-approve');
    reply = { status: 201, body: { schemaReady: true, gates: [gate({ status: 'approved', chip: { label: 'Approved', tone: 'good' }, decision: row() as never })] } };
    fireEvent.click(approve);
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].url).toBe('/api/org/org1/approvals/decide');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ subject: { kind: 'song', id: SONG }, gate: 'legal', decision: 'approved' });
    await waitFor(() => expect(screen.getByTestId('org-approval-chip-legal').textContent).toContain('Approved'));
    expect(toast.success).toHaveBeenCalledWith('Approved');
  });

  it('Request changes needs a note before it can be sent', async () => {
    mount(decider());
    fireEvent.click(await screen.findByTestId('org-approval-changes'));
    const send = screen.getByTestId('org-approval-send-changes');
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('org-approval-note'), { target: { value: 'Add Nova’s IPI' } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    reply = { status: 201, body: { schemaReady: true, gates: [gate({ status: 'changes_requested', chip: { label: 'Changes requested', tone: 'warn' }, decision: row({ decision: 'changes_requested', note: 'Add Nova’s IPI' }) as never })] } };
    fireEvent.click(send);
    await waitFor(() => expect(calls.length).toBe(2));
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ decision: 'changes_requested', note: 'Add Nova’s IPI' });
    await waitFor(() => expect(screen.getByTestId('org-approval-chip-legal').textContent).toContain('Changes requested'));
  });

  it('a requester who is not owner/admin sees Approve disabled with the reason', async () => {
    mount(decider({ selfApprovalBlocked: true }));
    const approve = await screen.findByTestId('org-approval-approve');
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(approve.getAttribute('title')).toBe('You cannot approve a request you made yourself');
  });

  it('the server’s own words are the error', async () => {
    mount(decider());
    const approve = await screen.findByTestId('org-approval-approve');
    reply = { status: 422, body: { error: 'Legal readiness has 2 blockers; clear them before approving' } };
    fireEvent.click(approve);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Legal readiness has 2 blockers; clear them before approving'));
    expect(screen.getByTestId('org-approval-chip-legal').textContent).toContain('Awaiting approval');
  });
});

describe('asking', () => {
  it('opens a form, sends the chosen approver and the note', async () => {
    mount(gate({ canRequest: true, approvers: [{ userId: 'u1', name: 'Lena Legal' }, { userId: 'u2', name: 'Owen Owner' }] }));
    fireEvent.click(await screen.findByTestId('org-approval-ask'));
    const form = screen.getByTestId('org-approval-ask-form');
    expect((within(form).getByTestId('org-approval-send-request') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(form).getByLabelText('Who should approve'));
    fireEvent.click(await screen.findByRole('option', { name: /Lena Legal/ }));
    fireEvent.change(within(form).getByLabelText('A note for the approver'), { target: { value: 'splits are final' } });
    reply = { status: 201, body: { schemaReady: true, gates: [gate({ status: 'requested', chip: { label: 'Awaiting approval', tone: 'waiting' }, pending: row({ decision: 'requested', approver: 'Lena Legal' }) as never })] } };
    fireEvent.click(within(form).getByTestId('org-approval-send-request'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].url).toBe('/api/org/org1/approvals');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ subject: { kind: 'song', id: SONG }, gate: 'legal', approver_id: 'u1', note: 'splits are final' });
    await waitFor(() => expect(screen.getByTestId('org-approval-chip-legal').textContent).toContain('Awaiting approval'));
  });
});

describe('changedText', () => {
  it('names the parts in words', () => {
    expect(changedText(['songs'])).toBe('splits or credits');
    expect(changedText(['items', 'release'])).toBe('the tracklist and the release details');
    expect(changedText([])).toBe('what was approved');
  });
});
