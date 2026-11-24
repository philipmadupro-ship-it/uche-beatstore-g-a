import { describe, it, expect } from 'vitest';
import { profileCompleteness } from './completeness';

const empty = {
  display_name: '', bio: '', hero_image_url: '', credits: '',
  license_lease_price_usd: '', license_exclusive_price_usd: '', license_notes: '',
  contact_email: '', instagram_handle: '', twitter_handle: '',
  spotify_url: '', soundcloud_url: '', website_url: '',
};

describe('profileCompleteness', () => {
  it('counts nothing for an empty form and names everything missing', () => {
    const r = profileCompleteness(empty);
    expect(r.filled).toBe(0);
    expect(r.total).toBe(9);
    expect(r.missing).toHaveLength(9);
  });
  it('ignores whitespace-only values', () => {
    expect(profileCompleteness({ ...empty, bio: '   \n' }).filled).toBe(0);
  });
  it('treats any one social link as "A link"', () => {
    const r = profileCompleteness({ ...empty, website_url: 'https://x.test' });
    expect(r.filled).toBe(1);
    expect(r.missing).not.toContain('A link');
  });
  it('a price of 0 still counts as filled', () => {
    expect(profileCompleteness({ ...empty, license_lease_price_usd: '0' }).missing).not.toContain('Lease price');
  });
});
