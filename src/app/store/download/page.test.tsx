// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const mockToastError = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('session_id=cs_test_123'),
}));
vi.mock('@/hooks/usePlayer', () => ({
  usePlayer: () => ({ currentTrack: null, isPlaying: false, setTrack: vi.fn(), togglePlay: vi.fn(), setQueue: vi.fn() }),
}));
vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@/hooks/useToast', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a) } }));
vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: () => null }));
vi.mock('@/components/providers/ArtworkThemeProvider', () => ({
  PublicArtworkThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import DownloadPortalWrapper from './page';

const FILE_URL = '/api/store/download-file?session_id=cs_test_123&track_id=t1&format=mp3';

const delivery = {
  purchase: { id: 'p1', buyer_email: 'buyer@example.test', amount_usd: 30, created_at: '2026-01-01T00:00:00Z', status: 'paid' },
  tracks: [{
    id: 't1', title: 'Night Shift', license_type: 'lease', file_types: ['MP3'],
    downloads: [{ format: 'mp3', label: 'MP3', proxied_url: FILE_URL }],
  }],
};

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), body: null };
}

/** The probe the page makes before saving; everything else is the delivery lookup. */
function mockNetwork(probe: { status: number; body?: unknown }) {
  const fetchMock = vi.fn((url: string) => {
    if (String(url).startsWith('/api/store/delivery')) return Promise.resolve(jsonRes(200, delivery));
    return Promise.resolve(jsonRes(probe.status, probe.body ?? {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let clicked: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute('href') ?? '');
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/store/download', () => {
  it('saves the file once the gated route agrees to serve it', async () => {
    const fetchMock = mockNetwork({ status: 206 });
    render(<DownloadPortalWrapper />);

    fireEvent.click(await screen.findByRole('button', { name: /download/i }));

    await waitFor(() => expect(clicked).toEqual([FILE_URL]));
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, expect.objectContaining({ headers: { Range: 'bytes=0-0' } }));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('says why and saves nothing when the route refuses (access revoked after the page loaded)', async () => {
    mockNetwork({ status: 403, body: { error: 'Download access revoked (refunded or disputed)' } });
    render(<DownloadPortalWrapper />);

    fireEvent.click(await screen.findByRole('button', { name: /download/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      'MP3 could not be downloaded',
      'Download access revoked (refunded or disputed)',
    ));
    expect(clicked).toEqual([]);
    // The button is usable again rather than stuck on "Saving…".
    expect((await screen.findByRole('button', { name: /download/i })).hasAttribute('disabled')).toBe(false);
  });

  it('shows the route\'s refusal on load when the purchase is on hold', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonRes(403, {
      error: 'Downloads for this purchase are on hold while the producer reviews it. They will be in touch by email.',
    }))));
    render(<DownloadPortalWrapper />);

    expect(await screen.findByText(/on hold while the producer reviews/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });
});
