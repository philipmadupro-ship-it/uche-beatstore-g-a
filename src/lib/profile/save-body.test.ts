import { describe, it, expect } from 'vitest';
import { CreatorProfilePatchSchema } from '@/lib/contracts';
import { pickProvidedProfileFields } from './patch';
import { isInlineImageData, profileSaveBody, profileSaveError, type ProfileFormState } from './save-body';

const form: ProfileFormState = {
  display_name: 'U2C',
  bio: 'New bio',
  hero_image_url: 'https://cdn.example/covers/hero.webp',
  credits: 'Drake — Honestly Nevermind',
  license_lease_price_usd: '150',
  license_exclusive_price_usd: '',
  license_notes: '',
  license_agreement: '',
  default_discount_percent: '20',
  contact_email: 'beats@example.com',
  instagram_handle: 'u2c',
  twitter_handle: '',
  spotify_url: '',
  soundcloud_url: '',
  website_url: '',
  accent_color: '#6DC6A4',
  font_style: 'modern',
};

// What FileReader.readAsDataURL produced for a ~150 KB photo.
const dataUrl = `data:image/jpeg;base64,${'A'.repeat(200_000)}`;

describe('profile save body', () => {
  it('is accepted by the /api/profile contract', () => {
    const parsed = CreatorProfilePatchSchema.safeParse(profileSaveBody(form));
    expect(parsed.success).toBe(true);
  });

  it('names every form field, so the route writes each one', () => {
    const body = profileSaveBody(form);
    const written = pickProvidedProfileFields(
      Object.fromEntries(Object.keys(form).map((k) => [k, 'x'])),
      body,
    );
    expect(Object.keys(written).sort()).toEqual(Object.keys(form).sort());
  });

  it('sends numbers for prices and null for blank ones (blank inherits, it is not free)', () => {
    const body = profileSaveBody(form);
    expect(body.license_lease_price_usd).toBe(150);
    expect(body.license_exclusive_price_usd).toBeNull();
    expect(body.default_discount_percent).toBe(20);
  });

  // The regression: an inline photo failed the contract and took the whole
  // profile down with it.
  it('an inline image would fail the contract for the entire profile', () => {
    const parsed = CreatorProfilePatchSchema.safeParse(profileSaveBody({ ...form, hero_image_url: dataUrl }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(['hero_image_url']);
  });

  it('refuses to send inline image data, with a message a producer can act on', () => {
    expect(profileSaveError({ ...form, hero_image_url: dataUrl })).toMatch(/upload/i);
    expect(profileSaveError(form)).toBeNull();
    expect(profileSaveError({ ...form, hero_image_url: '' })).toBeNull();
  });

  it('recognises data URLs regardless of case or leading space', () => {
    expect(isInlineImageData(' DATA:image/png;base64,AAA')).toBe(true);
    expect(isInlineImageData('https://cdn.example/data:x')).toBe(false);
  });
});
