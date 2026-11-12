// @vitest-environment jsdom

/**
 * The export / deletion panel: owners only, the delete button waits for the
 * typed name AND the confirmation toast, a stale sign-in turns into a "send me
 * a link" step, and nothing is sent to the server before it should be.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const ORG = { id: '22222222-2222-4222-8222-222222222222', name: 'Night Shift', slug: 'night-shift', kind: 'label' };

const confirmToast = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const toastSuccess = vi.fn();
const signInWithOtp = vi.fn<(args: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));

vi.mock('@/hooks/useToast', () => ({
  confirmToast: (...args: unknown[]) => confirmToast(...args),
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: 'owner@example.com' } } }),
      signInWithOtp: (args: unknown) => signInWithOtp(args),
    },
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
const assign = vi.fn();

beforeEach(() => {
  confirmToast.mockReset();
  confirmToast.mockResolvedValue(true);
  toastSuccess.mockReset();
  signInWithOtp.mockClear();
  assign.mockReset();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ restoreUrl: `/restore/${ORG.id}` }), blob: async () => new Blob(['{}']), headers: new Headers() }));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', { value: { assign, origin: 'https://app.test' }, writable: true });
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { OrgDataPanel } = await import('./OrgDataPanel');
const deleteButton = () => screen.getByRole('button', { name: /Delete this organization/ }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value } });

describe('OrgDataPanel', () => {
  it('tells a non-owner it is for owners and offers nothing', () => {
    render(<OrgDataPanel org={ORG} isOwner={false} />);
    expect(screen.getByText('Owners only')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps Delete off until the exact name is typed', () => {
    render(<OrgDataPanel org={ORG} isOwner />);
    expect(deleteButton().disabled).toBe(true);
    type('night shift');
    expect(deleteButton().disabled).toBe(true);
    type('Night Shift');
    expect(deleteButton().disabled).toBe(false);
  });

  it('asks for confirmation, and sends nothing if it is declined', async () => {
    confirmToast.mockResolvedValue(false);
    render(<OrgDataPanel org={ORG} isOwner />);
    type('Night Shift');
    fireEvent.click(deleteButton());
    await waitFor(() => expect(confirmToast).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('deletes with the typed name and then goes to the restore page', async () => {
    render(<OrgDataPanel org={ORG} isOwner />);
    type('Night Shift');
    fireEvent.click(deleteButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`/restore/${ORG.id}`));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/org/${ORG.id}`);
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ confirmName: 'Night Shift' });
    expect(confirmToast.mock.calls[0][2]).toMatchObject({ danger: true });
  });

  it('a stale sign-in becomes a "send me a link" step that returns to this page', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Sign in again to continue', requiresReauth: true }) });
    render(<OrgDataPanel org={ORG} isOwner />);
    type('Night Shift');
    fireEvent.click(deleteButton());
    const send = await screen.findByRole('button', { name: /Send me a sign-in link/ });
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(send);
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    const arg = signInWithOtp.mock.calls[0][0] as { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } };
    expect(arg.email).toBe('owner@example.com');
    expect(arg.options.shouldCreateUser).toBe(false);
    expect(arg.options.emailRedirectTo).toBe(`https://app.test/auth/callback?next=${encodeURIComponent('/o/night-shift/settings/data')}`);
    expect(await screen.findByText(/We sent a sign-in link to owner@example.com/)).toBeTruthy();
  });

  it('shows the server’s refusal instead of navigating', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'The producer workspace cannot be deleted from here' }) });
    render(<OrgDataPanel org={ORG} isOwner />);
    type('Night Shift');
    fireEvent.click(deleteButton());
    expect((await screen.findByRole('alert')).textContent).toContain('producer workspace');
    expect(assign).not.toHaveBeenCalled();
  });

  it('exports JSON and CSV through the export route', async () => {
    render(<OrgDataPanel org={ORG} isOwner />);
    fireEvent.click(screen.getByRole('button', { name: /Download JSON/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/org/${ORG.id}/export?format=json`);
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/org/${ORG.id}/export?format=csv`);
  });

  it('an export that needs a fresh sign-in offers the link', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ requiresReauth: true }) });
    render(<OrgDataPanel org={ORG} isOwner />);
    fireEvent.click(screen.getByRole('button', { name: /Download JSON/ }));
    expect(await screen.findByRole('button', { name: /Send me a sign-in link/ })).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not offer to delete the producer’s own workspace', () => {
    render(<OrgDataPanel org={{ ...ORG, kind: 'producer' }} isOwner />);
    expect(screen.queryByRole('button', { name: /Delete this organization/ })).toBeNull();
    expect(screen.getByText(/producer workspace/i)).toBeTruthy();
  });
});
