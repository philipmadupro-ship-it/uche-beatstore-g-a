import { normalisePalette } from './palette';
import { normaliseTagColors, type TagColorMap } from './tag-colors';
import type { ArtworkKind } from './gradient';

/**
 * The producer's artwork identity, in a shape a public page can be handed.
 *
 * Generated artwork needs three things the dashboard gets from authenticated
 * endpoints: the default image per kind, the palette extracted from it, and
 * the producer's tag-colour overrides. `/api/profile` and `/api/tags/colors`
 * both 401 for anyone not signed in, so a buyer's browser has no route to any
 * of it — which is why every coverless beat on the storefront rendered as a
 * grey square or an accent-tinted gradient that had nothing to do with the
 * brand.
 *
 * Passing it down with the page's own data rather than adding a public
 * endpoint keeps it inside the response that is already edge-cached, and
 * means a card never issues a request of its own.
 */
export interface PublicArtworkTheme {
  logo_url: string | null;
  artwork: Record<ArtworkKind, { url: string | null; palette: string[] }>;
  tag_colors: TagColorMap;
}

export const EMPTY_ARTWORK_THEME: PublicArtworkTheme = {
  logo_url: null,
  artwork: {
    track: { url: null, palette: [] },
    project: { url: null, palette: [] },
    playlist: { url: null, palette: [] },
  },
  tag_colors: {},
};

/** The creator_profiles columns a theme is built from. */
export const ARTWORK_PROFILE_COLUMNS = [
  'logo_url',
  'default_artwork_url',
  'default_artwork_palette',
  'default_artwork_project_url',
  'default_artwork_project_palette',
  'default_artwork_playlist_url',
  'default_artwork_playlist_palette',
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Build a theme from an already-loaded creator_profiles row.
 *
 * Tolerant of a row that predates migration 108: the columns are read
 * defensively so a profile fetched with an older column list degrades to "no
 * default artwork" rather than throwing.
 */
export function artworkThemeFromProfile(profile: any, tagColors?: unknown): PublicArtworkTheme {
  const p = profile ?? {};
  return {
    logo_url: p.logo_url ?? null,
    artwork: {
      track: {
        url: p.default_artwork_url ?? null,
        palette: normalisePalette(p.default_artwork_palette),
      },
      project: {
        url: p.default_artwork_project_url ?? null,
        palette: normalisePalette(p.default_artwork_project_palette),
      },
      playlist: {
        url: p.default_artwork_playlist_url ?? null,
        palette: normalisePalette(p.default_artwork_playlist_palette),
      },
    },
    tag_colors: normaliseTagColors(tagColors),
  };
}

/**
 * Load a producer's artwork theme for a public page.
 *
 * Never throws. A storefront that renders without artwork is a worse
 * storefront; a storefront that 500s because a colour lookup failed is not a
 * storefront at all — so every failure here degrades to the empty theme, which
 * `ArtworkFallback` handles by falling back to the app accent.
 */
export async function loadPublicArtworkTheme(
  admin: any,
  sellerUserId: string | null | undefined,
): Promise<PublicArtworkTheme> {
  if (!admin || !sellerUserId) return EMPTY_ARTWORK_THEME;

  try {
    const [profileRes, tagRes] = await Promise.all([
      admin
        .from('creator_profiles')
        .select(ARTWORK_PROFILE_COLUMNS.join(', '))
        .eq('user_id', sellerUserId)
        .maybeSingle(),
      admin.from('tag_colors').select('tag, color').eq('user_id', sellerUserId),
    ]);

    const tagColors: Record<string, string> = {};
    for (const row of (tagRes?.data ?? []) as any[]) {
      if (row?.tag && row?.color) tagColors[row.tag] = row.color;
    }

    // A profile error is usually the artwork columns not existing yet on an
    // environment that has not run migration 108/109.
    if (profileRes?.error) return { ...EMPTY_ARTWORK_THEME, tag_colors: normaliseTagColors(tagColors) };

    return artworkThemeFromProfile(profileRes?.data, tagColors);
  } catch {
    return EMPTY_ARTWORK_THEME;
  }
}
