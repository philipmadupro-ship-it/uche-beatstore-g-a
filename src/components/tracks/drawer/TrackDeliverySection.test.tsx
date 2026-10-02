// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: (...a: unknown[]) => mockToastSuccess(...a) },
}));

import { TrackDeliverySection } from './TrackDeliverySection';

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

const READY = { state: 'ready', label: 'MP3 ready', detail: 'A 320 kbps MP3 has been made from your master and is what a lease delivers.', canMake: false };
const MASTER = { state: 'master', label: 'MP3 ready', detail: 'The master is already an MP3, so a lease delivers it as it is.', canMake: false };
const PENDING = { state: 'pending', label: 'MP3 not made yet', detail: 'A lease delivers an MP3 made from your master. It is made the first time a buyer downloads it — make it now so nobody waits.', canMake: true };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TrackDeliverySection', () => {
  it('says "MP3 ready" for an MP3 master and offers nothing to do', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, MASTER)));
    render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/k.mp3" />);

    expect((await screen.findByTestId('mp3-state')).getAttribute('data-state')).toBe('master');
    expect(screen.getByText('MP3 ready')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /make mp3/i })).toBeNull();
  });

  it('shows "not made yet" for a WAV master, and Make MP3 now turns it ready', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(200, PENDING))
      .mockResolvedValueOnce(res(200, READY));
    vi.stubGlobal('fetch', fetchMock);
    render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/k.wav" />);

    expect((await screen.findByTestId('mp3-state')).getAttribute('data-state')).toBe('pending');
    fireEvent.click(screen.getByRole('button', { name: /make mp3 now/i }));

    await waitFor(() => expect(screen.getByTestId('mp3-state').getAttribute('data-state')).toBe('ready'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tracks/t1/mp3', { method: 'POST' });
    expect(mockToastSuccess).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /make mp3/i })).toBeNull();
  });

  it('keeps saying "not made yet" and shows the reason when it cannot be made', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res(200, PENDING))
      .mockResolvedValueOnce(res(503, { error: 'The MP3 could not be made. Check that ffmpeg is available.' })));
    render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/k.wav" />);

    fireEvent.click(await screen.findByRole('button', { name: /make mp3 now/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('MP3 not made', expect.stringMatching(/ffmpeg/)));
    expect(screen.getByTestId('mp3-state').getAttribute('data-state')).toBe('pending');
    // The button is usable again.
    expect((screen.getByRole('button', { name: /make mp3 now/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says it could not check, and Retry checks again', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res(500, { error: 'x' }))
      .mockResolvedValueOnce(res(200, READY)));
    render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/k.wav" />);

    expect(await screen.findByText(/could not check the mp3/i)).toBeTruthy();
    // It never claims ready on a failed check.
    expect(screen.queryByTestId('mp3-state')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId('mp3-state').getAttribute('data-state')).toBe('ready'));
  });

  it('renders nothing without Supabase (501)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(501, { error: 'Needs Supabase.' })));
    const { container } = render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/k.wav" />);

    await waitFor(() => expect(container.querySelector('[data-testid="track-delivery"]')).toBeNull());
  });

  it('checks again when the master changes (a version revert)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(200, READY))
      .mockResolvedValueOnce(res(200, PENDING));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<TrackDeliverySection trackId="t1" audioUrl="r2://b/old.wav" />);
    await waitFor(() => expect(screen.getByTestId('mp3-state').getAttribute('data-state')).toBe('ready'));

    rerender(<TrackDeliverySection trackId="t1" audioUrl="r2://b/new.wav" />);

    await waitFor(() => expect(screen.getByTestId('mp3-state').getAttribute('data-state')).toBe('pending'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
