// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfilePage from './page';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'p@example.com' }, signOut: vi.fn(async () => ({ error: null })) }),
}));
vi.mock('@/components/ui/MusicReactiveBackdrop', () => ({ MusicReactiveBackdrop: () => null }));

/**
 * The profile page was re-laid-out (identity card, flat sections). The payload
 * it POSTs to /api/profile must not change: same keys, none dropped or renamed.
 */
const SAVE_KEYS = [
  'accent_color', 'bio', 'contact_email', 'credits', 'default_discount_percent',
  'display_name', 'font_style', 'hero_image_url', 'instagram_handle',
  'license_agreement', 'license_exclusive_price_usd', 'license_lease_price_usd',
  'license_notes', 'soundcloud_url', 'spotify_url', 'twitter_handle', 'website_url',
];

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        profile: { display_name: 'U2C', bio: 'Hi', license_lease_price_usd: 30, accent_color: '#6DC6A4', font_style: 'serif' },
      }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProfilePage', () => {
  it('Save sends exactly the same body keys as before the redesign', async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue('U2C');
    fireEvent.change(screen.getByPlaceholderText('e.g. 20'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    const body = JSON.parse(post[1].body as string);
    expect(Object.keys(body).sort()).toEqual(SAVE_KEYS);
    expect(body).toMatchObject({
      display_name: 'U2C', license_lease_price_usd: 30, license_exclusive_price_usd: null,
      default_discount_percent: 15, accent_color: '#6DC6A4', font_style: 'serif',
    });
  });

  it('keeps Sign out and reports completeness from the loaded fields', async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue('U2C');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    // name, bio, lease price filled -> 3 of 9
    expect(screen.getByRole('progressbar', { name: 'Profile completeness' }).getAttribute('aria-valuenow')).toBe('3');
  });
});
