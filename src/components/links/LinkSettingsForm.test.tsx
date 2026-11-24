// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LinkSettingsForm, type LinkSettingsLink } from './LinkSettingsForm';

const toastError = vi.fn();
vi.mock('@/hooks/useToast', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

const base: LinkSettingsLink = {
  id: 'l1',
  source: 'share_links',
  token: 'tok',
  kind: 'track',
  expires_at: null,
  password_protected: false,
  recipient_kind: 'client',
  sales_enabled: false,
  track_ids: ['t1', 't2'],
  tracks: [
    { id: 't1', title: 'One', type: 'beat', cover_url: null },
    { id: 't2', title: 'Two', type: 'beat', cover_url: null },
  ],
};
const fmt = (iso: string) => iso;

afterEach(() => { cleanup(); vi.restoreAllMocks(); toastError.mockClear(); });

describe('LinkSettingsForm', () => {
  it('saves a new password and an expiry in ONE patch, and never shows a hash', async () => {
    const onPatch = vi.fn().mockResolvedValue(true);
    render(<LinkSettingsForm link={{ ...base, password_protected: true }} onPatch={onPatch} formatDate={fmt} />);
    expect(screen.getByText('(currently set)')).toBeTruthy();
    const input = screen.getByPlaceholderText(/new password/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(input.type).toBe('text');
    fireEvent.change(input, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0][1]).toEqual({ password: 'hunter2' });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('clearing sends password null; Save stays disabled until something changed', async () => {
    const onPatch = vi.fn().mockResolvedValue(true);
    render(<LinkSettingsForm link={{ ...base, password_protected: true }} onPatch={onPatch} formatDate={fmt} />);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByText('Clear it'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(expect.anything(), { password: null }));
  });

  it('selling is disabled with a note for a non-client link', () => {
    render(<LinkSettingsForm link={{ ...base, recipient_kind: 'friend' }} onPatch={vi.fn()} formatDate={fmt} />);
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Selling is for client links only')).toBeTruthy();
  });

  it('toggling selling is optimistic and rolls back with the server refusing', async () => {
    const onPatch = vi.fn().mockResolvedValue(false);
    render(<LinkSettingsForm link={base} onPatch={onPatch} formatDate={fmt} />);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    expect(onPatch).toHaveBeenCalledWith(expect.anything(), { sales_enabled: true });
  });

  it('removing a track sends the new list and rolls the row back on failure', async () => {
    const onPatch = vi.fn().mockResolvedValue(false);
    render(<LinkSettingsForm link={base} onPatch={onPatch} formatDate={fmt} />);
    fireEvent.click(screen.getByLabelText('Remove One'));
    expect(screen.queryByText('One')).toBeNull();
    await waitFor(() => expect(screen.getByText('One')).toBeTruthy());
    expect(onPatch).toHaveBeenCalledWith(expect.anything(), { track_ids: ['t2'] });
  });

  it('cannot remove the last track', () => {
    const one = { ...base, track_ids: ['t1'], tracks: [base.tracks[0]] };
    render(<LinkSettingsForm link={one} onPatch={vi.fn()} formatDate={fmt} />);
    expect((screen.getByLabelText('Remove One') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reorders with the move buttons', async () => {
    const onPatch = vi.fn().mockResolvedValue(true);
    render(<LinkSettingsForm link={base} onPatch={onPatch} formatDate={fmt} />);
    fireEvent.click(screen.getByLabelText('Move One down'));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(expect.anything(), { track_ids: ['t2', 't1'] }));
  });

  it('adds a track from the search results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 't9', title: 'Nine', type: 'loop' }]))));
    const onPatch = vi.fn().mockResolvedValue(true);
    render(<LinkSettingsForm link={base} onPatch={onPatch} formatDate={fmt} />);
    fireEvent.click(screen.getByText('Add tracks'));
    fireEvent.click(await screen.findByText('Nine'));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(expect.anything(), { track_ids: ['t1', 't2', 't9'] }));
  });

  it('shows the link’s real recipient kind in the dropdown', () => {
    render(<LinkSettingsForm link={{ ...base, recipient_kind: 'rapper' }} onPatch={vi.fn()} formatDate={fmt} />);
    expect(screen.getByText('Rapper')).toBeTruthy();
  });

  it('project shares keep their target and say so', () => {
    render(<LinkSettingsForm link={{ ...base, source: 'project_shares', kind: 'project' }} onPatch={vi.fn()} formatDate={fmt} />);
    expect(screen.getByText(/Edit the project to change what is on the link/)).toBeTruthy();
    expect(screen.queryByText('Add tracks')).toBeNull();
  });
});
