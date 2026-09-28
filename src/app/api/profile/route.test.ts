/**
 * POST /api/profile — what the /profile page's Save button hits.
 *
 * The regression this guards: the page sent the hero photo as a data: URL,
 * the contract rejected it, and the whole profile save failed with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { profileSaveBody, type ProfileFormState } from '@/lib/profile/save-body';

const mockUpdate = vi.fn();
vi.mock('@/lib/actions/profile', () => ({
  getCreatorProfile: vi.fn(),
  updateCreatorProfile: (payload: Record<string, unknown>) => mockUpdate(payload),
}));

import { POST } from './route';

const form: ProfileFormState = {
  display_name: 'U2C',
  bio: 'New bio',
  hero_image_url: 'https://cdn.example/covers/hero.webp',
  credits: '',
  license_lease_price_usd: '150',
  license_exclusive_price_usd: '',
  license_notes: '',
  license_agreement: '',
  default_discount_percent: '',
  contact_email: 'beats@example.com',
  instagram_handle: 'u2c',
  twitter_handle: '',
  spotify_url: '',
  soundcloud_url: '',
  website_url: '',
  accent_color: '#6DC6A4',
  font_style: 'modern',
};

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockImplementation(async (payload: Record<string, unknown>) => ({ profile: { user_id: 'u1', ...payload } }));
});

describe('POST /api/profile', () => {
  it('persists the page body, every field included', async () => {
    const res = await post(profileSaveBody(form));
    expect(res.status).toBe(200);
    const written = mockUpdate.mock.calls[0][0];
    expect(written).toMatchObject({
      display_name: 'U2C',
      bio: 'New bio',
      hero_image_url: 'https://cdn.example/covers/hero.webp',
      license_lease_price_usd: 150,
      license_exclusive_price_usd: null,
      contact_email: 'beats@example.com',
      accent_color: '#6DC6A4',
      font_style: 'modern',
    });
    // The owner comes from the session inside updateCreatorProfile, never the body.
    expect(written).not.toHaveProperty('user_id');
    const json = await res.json();
    expect(json.profile.bio).toBe('New bio');
  });

  it('rejects an inline hero image without writing anything', async () => {
    const res = await post(profileSaveBody({ ...form, hero_image_url: `data:image/jpeg;base64,${'A'.repeat(200_000)}` }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores a user_id smuggled into the body', async () => {
    await post({ ...profileSaveBody(form), user_id: 'someone-else' });
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('user_id');
  });

  it('403s a signed-in buyer and 401s a signed-out caller', async () => {
    mockUpdate.mockResolvedValueOnce({ error: 'Producer account required', profile: null, forbidden: true });
    expect((await post(profileSaveBody(form))).status).toBe(403);
    mockUpdate.mockResolvedValueOnce({ error: 'Not authenticated', profile: null });
    expect((await post(profileSaveBody(form))).status).toBe(401);
  });
});
