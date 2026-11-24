/**
 * How filled-in the public profile is, worked out from the form's own fields.
 *
 * Presentation only: nothing is stored, nothing new is asked for. The list is
 * the handful of fields a buyer actually sees on the producer page and the
 * license card, so "Missing" names things the producer can go and add.
 * Colour and font are left out on purpose: they always have a value.
 */
import type { ProfileFormState } from './save-body';

type Filled = Pick<
  ProfileFormState,
  | 'display_name' | 'bio' | 'hero_image_url' | 'credits'
  | 'license_lease_price_usd' | 'license_exclusive_price_usd' | 'license_notes'
  | 'contact_email' | 'instagram_handle' | 'twitter_handle'
  | 'spotify_url' | 'soundcloud_url' | 'website_url'
>;

export type ProfileCompleteness = { filled: number; total: number; missing: string[] };

const has = (v: string | null | undefined) => !!v && v.trim() !== '';

export function profileCompleteness(p: Filled): ProfileCompleteness {
  const checks: Array<[string, boolean]> = [
    ['Name', has(p.display_name)],
    ['Photo', has(p.hero_image_url)],
    ['Bio', has(p.bio)],
    ['Credits', has(p.credits)],
    ['Lease price', has(p.license_lease_price_usd)],
    ['Exclusive price', has(p.license_exclusive_price_usd)],
    ['License notes', has(p.license_notes)],
    ['Contact email', has(p.contact_email)],
    [
      'A link',
      [p.instagram_handle, p.twitter_handle, p.spotify_url, p.soundcloud_url, p.website_url].some(has),
    ],
  ];
  return {
    filled: checks.filter(([, ok]) => ok).length,
    total: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}
