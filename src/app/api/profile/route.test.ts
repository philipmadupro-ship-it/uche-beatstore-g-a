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

const mockEnsure = vi.fn();
const serviceClient = { tag: 'service-role' };
vi.mock('@/lib/labelos/personal-org', () => ({
  ensurePersonalOrg: (admin: unknown, userId: string) => mockEnsure(admin, userId),
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => serviceClient,
}));

import { POST } from './route';

const PRODUCER = '00000000-0000-4000-8000-000000000001';

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
  mockEnsure.mockResolvedValue({ status: 'exists', orgId: 'org-1' });
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

  it('persists the Store Editor theme, text colour included (STORE-06)', async () => {
    // The contract used to omit text_color_primary, so zod stripped it and the
    // Store Editor's text colour reset to white on every reload.
    const res = await post({ accent_color: '#c8a47a', font_style: 'mono', text_color_primary: '#6DC6A4' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      accent_color: '#c8a47a',
      font_style: 'mono',
      text_color_primary: '#6DC6A4',
    });
  });

  it('writes the Store Editor Design layout (STORE-08)', async () => {
    // The route's whitelist never named store_layout: the builder's autosave
    // got a 200 and the layout was dropped, so no Design section ever reached /store.
    const layout = {
      version: 1,
      sections: [{
        id: 'video-1',
        kind: 'video',
        visible: { desktop: true, tablet: true, mobile: true },
        base: {},
        content: { videoUrl: 'https://youtu.be/dQw4w9WgXcQ', mediaSize: 50 },
      }],
      theme: { accent: '#c8a47a' },
      updatedAt: '2026-09-29T00:00:00.000Z',
    };
    const res = await post({ store_layout: layout });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0]).toEqual({ store_layout: layout });
  });

  it('clears the Design layout on null and leaves it alone when not named', async () => {
    await post({ store_layout: null });
    expect(mockUpdate.mock.calls[0][0]).toEqual({ store_layout: null });
    await post(profileSaveBody(form));
    expect(mockUpdate.mock.calls[1][0]).not.toHaveProperty('store_layout');
  });

  it('clears the text colour back to the default on an empty value', async () => {
    await post({ text_color_primary: '' });
    expect(mockUpdate.mock.calls[0][0]).toEqual({ text_color_primary: null });
  });

  it('leaves the text colour alone when a save does not name it (the /profile page)', async () => {
    await post(profileSaveBody(form));
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('text_color_primary');
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

describe('POST /api/profile → personal org (LABEL-07)', () => {
  beforeEach(() => {
    mockUpdate.mockImplementation(async (payload: Record<string, unknown>) => ({ profile: { user_id: PRODUCER, ...payload } }));
  });

  it('ensures the saved producer\'s org with the service-role client', async () => {
    mockEnsure.mockResolvedValueOnce({ status: 'created', orgId: 'org-1' });
    const res = await post(profileSaveBody(form));
    expect(res.status).toBe(200);
    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(mockEnsure).toHaveBeenCalledWith(serviceClient, PRODUCER);
  });

  it('uses the saved row\'s owner, never one from the body', async () => {
    await post({ ...profileSaveBody(form), user_id: '00000000-0000-4000-8000-0000000000ff' });
    expect(mockEnsure).toHaveBeenCalledWith(serviceClient, PRODUCER);
  });

  it.each([
    ['skipped (136/137 not applied)', { status: 'skipped', reason: 'schema_missing' }],
    ['failed', { status: 'failed', error: 'boom' }],
  ])('still saves the profile when the helper is %s', async (_label, outcome) => {
    mockEnsure.mockResolvedValueOnce(outcome);
    const res = await post(profileSaveBody(form));
    expect(res.status).toBe(200);
    expect((await res.json()).profile.bio).toBe('New bio');
  });

  it('still saves the profile when the helper throws', async () => {
    mockEnsure.mockRejectedValueOnce(new Error('unexpected'));
    const res = await post(profileSaveBody(form));
    expect(res.status).toBe(200);
    expect((await res.json()).profile.bio).toBe('New bio');
  });

  it('does not run for a buyer, a signed-out caller or a failed save', async () => {
    mockUpdate.mockResolvedValueOnce({ error: 'Producer account required', profile: null, forbidden: true });
    expect((await post(profileSaveBody(form))).status).toBe(403);
    mockUpdate.mockResolvedValueOnce({ error: 'Not authenticated', profile: null });
    expect((await post(profileSaveBody(form))).status).toBe(401);
    mockUpdate.mockResolvedValueOnce({ error: 'db down', profile: null });
    expect((await post(profileSaveBody(form))).status).toBe(500);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('does not run in local-store mode (no database user id)', async () => {
    mockUpdate.mockImplementationOnce(async (payload: Record<string, unknown>) => ({ profile: { user_id: 'local-user', ...payload } }));
    expect((await post(profileSaveBody(form))).status).toBe(200);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
