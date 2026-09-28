/**
 * What the /profile page sends to `POST /api/profile`.
 *
 * The page used to read a picked hero photo with `FileReader.readAsDataURL`
 * and put the resulting `data:` URL straight into `hero_image_url`. The
 * contract caps that column at 2000 characters (it is a URL column, read on
 * every storefront render), so any real photo — hundreds of kilobytes of
 * base64 — failed validation, and because the body is validated as a whole,
 * the bio, prices and socials typed alongside it were thrown away too. The
 * photo now goes through `/api/upload/image` and only its URL is saved; this
 * module refuses to send inline image data rather than let the server reject
 * the entire profile over one field.
 */

export type ProfileFormState = {
  display_name: string;
  bio: string;
  hero_image_url: string;
  credits: string;
  license_lease_price_usd: string;
  license_exclusive_price_usd: string;
  license_notes: string;
  license_agreement: string;
  default_discount_percent: string;
  contact_email: string;
  instagram_handle: string;
  twitter_handle: string;
  spotify_url: string;
  soundcloud_url: string;
  website_url: string;
  accent_color: string;
  font_style: string;
};

/** A pasted or FileReader-produced image, not a URL the row can hold. */
export function isInlineImageData(value: string): boolean {
  return /^\s*data:/i.test(value);
}

/** Null when the form can be saved; otherwise a message naming the field. */
export function profileSaveError(profile: ProfileFormState): string | null {
  if (isInlineImageData(profile.hero_image_url)) {
    return 'The hero image is embedded image data, not a link. Click the photo to upload it instead.';
  }
  return null;
}

const toNumberOrNull = (value: string): number | null => (value ? Number(value) : null);

export function profileSaveBody(profile: ProfileFormState) {
  return {
    ...profile,
    license_lease_price_usd: toNumberOrNull(profile.license_lease_price_usd),
    license_exclusive_price_usd: toNumberOrNull(profile.license_exclusive_price_usd),
    default_discount_percent: toNumberOrNull(profile.default_discount_percent),
  };
}
