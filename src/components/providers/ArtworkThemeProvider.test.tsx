// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ArtworkThemeProvider } from './ArtworkThemeProvider';
import { useTagColors, useTagColorStore } from '@/hooks/useTagColors';
import { useBrandArtwork } from '@/hooks/useBrandArtwork';

/**
 * Public pages have no session. While their data loads the theme is null, and
 * the provider used to render no context at all — so the hooks below took the
 * dashboard path and called session-gated endpoints, a 401 for every buyer.
 */
function Artwork() {
  useTagColors();
  useBrandArtwork('track');
  return null;
}

const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  useTagColorStore.setState({ loaded: false, loading: false, colors: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const calledUrls = () => fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));

describe('ArtworkThemeProvider', () => {
  it('fetches nothing session-gated while a public page is still loading its theme', () => {
    render(<ArtworkThemeProvider theme={null}><Artwork /></ArtworkThemeProvider>);
    expect(calledUrls()).not.toContain('/api/tags/colors');
    expect(calledUrls()).not.toContain('/api/profile');
  });

  it('still lets the dashboard (no provider) fetch its own tag colours', () => {
    render(<Artwork />);
    expect(calledUrls()).toContain('/api/tags/colors');
  });
});
