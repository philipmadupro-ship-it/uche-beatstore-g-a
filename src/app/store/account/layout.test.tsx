// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import BuyerAccountLayout from './layout';
import { useTagColorStore } from '@/hooks/useTagColors';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { BuyerLibraryTile } from '@/components/store/BuyerLibraryTile';

/**
 * Regression: /store/account/me and /store/account/[token] drew artwork with no
 * theme provider, so the artwork hooks fetched the producer's session-gated
 * `/api/tags/colors` and `/api/profile` — two failing requests per page load
 * for every buyer. Found by logging every response >= 400 on /store/account/me.
 */
const fetchMock = vi.fn(async (url: string) => (
  String(url) === '/api/store/theme'
    ? new Response(JSON.stringify({ artworkTheme: { logo_url: null, artwork: { track: { url: null, palette: [] }, project: { url: null, palette: [] }, playlist: { url: null, palette: [] } }, tag_colors: {} } }), { status: 200 })
    : new Response('{"error":"Not authenticated"}', { status: 401 })
));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  useTagColorStore.setState({ loaded: false, loading: false, colors: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const calledUrls = () => fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
const PRODUCER_ONLY = ['/api/tags/colors', '/api/profile'];

describe('buyer account layout', () => {
  it('artwork on an account page never calls a producer-only endpoint', async () => {
    render(
      <BuyerAccountLayout>
        <ArtworkFallback src={null} seed="t1" kind="track" sizes="48px" className="object-cover"><span /></ArtworkFallback>
        <BuyerLibraryTile track={{ id: 't1', title: 'Night Shift', cover_url: null, bpm: 140, key: 'F', scale: 'minor' } as never} />
      </BuyerAccountLayout>,
    );
    // the public theme is the only thing it may ask for
    await waitFor(() => expect(calledUrls()).toContain('/api/store/theme'));
    for (const url of PRODUCER_ONLY) expect(calledUrls()).not.toContain(url);
  });

  it('the same tiles with no layout DO call them — this is what the layout prevents', () => {
    render(<ArtworkFallback src={null} seed="t1" kind="track" sizes="48px" className="object-cover"><span /></ArtworkFallback>);
    expect(calledUrls()).toEqual(expect.arrayContaining(PRODUCER_ONLY));
  });
});
