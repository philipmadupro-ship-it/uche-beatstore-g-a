/**
 * The storefront customization protocol (PROFILE-04).
 *
 * One versioned shape for everything a producer can customise — colours, type,
 * sections, links and layout — and ONE resolver that /store, the producer page
 * and the editor previews all call. Nothing new is stored: the inputs are the
 * existing profile columns (`accent_color`, `text_color_primary`,
 * `font_style`, the link columns) and `creator_profiles.store_layout`, so no
 * migration is involved. `parseCustomization` turns null / older / malformed
 * input into today's behaviour; a producer who never customised resolves to
 * exactly what the storefront drew before this module existed.
 *
 * Resolution rule (unchanged): a theme colour wins only when it differs from
 * the stock theme. Every saved layout carries a full theme, so "the layout has
 * a theme" says nothing — a producer who opened Design once to reorder sections
 * would otherwise lose the accent set on their profile.
 *
 * `lib/store/appearance.ts` and `lib/store/typography.ts` keep their original
 * exports as thin wrappers over this module.
 */

import { defaultStoreTheme, normalizeLayout, type StoreLayout, type StoreSection, type StoreTheme } from '@/lib/store-editor/layout';
import { storeSocialLinks, type StoreSocialLink } from './social-links';
import { normalizeThemeColor } from '@/lib/theme/colors';

/**
 * The font styles the storefront knows how to draw. `/profile` used to offer
 * `modern` and `minimal`, which nothing mapped, so both silently rendered the
 * default face; they are read as `default` here rather than as an error.
 */
export const STORE_FONT_STYLES = ['default', 'serif', 'mono'] as const;
export type StoreFontStyle = (typeof STORE_FONT_STYLES)[number];

export const STORE_FONT_LABELS: Record<StoreFontStyle, string> = {
  default: 'Sans (default)',
  serif: 'Serif',
  mono: 'Mono',
};

export const STORE_FONT_FAMILIES: Record<StoreFontStyle, string> = {
  default: '"Akira Expanded", system-ui, sans-serif',
  serif: '"Synkopy", "Akira Expanded", system-ui, sans-serif',
  mono: '"Panchang", ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function normalizeFontStyle(value: string | null | undefined): StoreFontStyle {
  return (STORE_FONT_STYLES as readonly string[]).includes(value ?? '')
    ? (value as StoreFontStyle)
    : 'default';
}

export const DEFAULT_STORE_TEXT_COLOR = '#FFFFFF';

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` — what the editor's picker and field produce. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The text colour to draw, or white.
 *
 * The editor's text field accepts anything while it is being typed, and the
 * value goes into a CSS custom property. A half-typed `#12` would make every
 * `var(--store-text)` consumer invalid at computed-value time — i.e. fall back
 * to `inherit`/transparent rather than white — so anything that is not a
 * complete hex colour reads as the default instead.
 */
export function storeTextColor(value: string | null | undefined): string {
  const v = value?.trim();
  return v && HEX_COLOR.test(v) ? v : DEFAULT_STORE_TEXT_COLOR;
}

export type StoreAppearanceProfile = {
  accent_color?: string | null;
  text_color_primary?: string | null;
  font_style?: string | null;
};

export type StoreAppearance = {
  accent: string;
  text: string;
  fontStyle: StoreFontStyle;
  fontFamily: string;
};

function sameColor(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

/** A theme colour the producer deliberately set, or null for "not touched". */
function themeOverride(value: string | null | undefined, stock: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed || sameColor(trimmed, stock)) return null;
  return trimmed;
}

export function resolveStoreAppearance(
  profile: StoreAppearanceProfile | null | undefined,
  theme?: Partial<StoreTheme> | null,
): StoreAppearance {
  const fontStyle = normalizeFontStyle(profile?.font_style);
  return {
    accent: themeOverride(theme?.accent, defaultStoreTheme.accent)
      ?? normalizeThemeColor(profile?.accent_color),
    text: storeTextColor(themeOverride(theme?.text, defaultStoreTheme.text) ?? profile?.text_color_primary),
    fontStyle,
    fontFamily: STORE_FONT_FAMILIES[fontStyle],
  };
}

/**
 * The theme the builder's preview should draw with: the stored theme, with
 * accent and text replaced by what the live storefront will actually use.
 * Without this the preview showed the stock tan accent while `/store` showed
 * the profile accent, for every producer who had not touched the theme.
 */
export function effectiveStoreTheme(
  theme: StoreTheme,
  profile: StoreAppearanceProfile | null | undefined,
): StoreTheme {
  const { accent, text } = resolveStoreAppearance(profile, theme);
  return { ...theme, accent, text };
}

/* ── The versioned document ─────────────────────────────────────────────── */

export const CUSTOMIZATION_VERSION = 1;

export type StoreCustomizationInput = {
  profile?: (StoreAppearanceProfile & Partial<Record<
    'instagram_handle' | 'twitter_handle' | 'spotify_url' | 'soundcloud_url' | 'website_url',
    string | null
  >>) | null;
  /** `creator_profiles.store_layout`, as stored: null, older or malformed is fine. */
  layout?: unknown;
};

export type StoreCustomization = {
  version: typeof CUSTOMIZATION_VERSION;
  /** Raw profile columns (colours + type). Resolved by `resolveCustomization`. */
  profile: StoreAppearanceProfile;
  /** The normalised layout: sections, per-breakpoint overrides and the theme. */
  layout: StoreLayout;
  sections: StoreSection[];
  theme: StoreTheme;
  /** Social destinations the storefront will actually link (invalid ones dropped). */
  links: StoreSocialLink[];
};

export type ResolvedCustomization = {
  appearance: StoreAppearance;
  /** The theme content sections draw with: stored theme + resolved accent/text. */
  sectionTheme: StoreTheme;
  /** Root style for any surface rendering the storefront. */
  rootStyle: Record<string, string>;
};

export function parseCustomization(input: StoreCustomizationInput | null | undefined): StoreCustomization {
  const layout = normalizeLayout(input?.layout);
  const p = input?.profile;
  return {
    version: CUSTOMIZATION_VERSION,
    profile: {
      accent_color: p?.accent_color ?? null,
      text_color_primary: p?.text_color_primary ?? null,
      font_style: p?.font_style ?? null,
    },
    layout,
    sections: layout.sections,
    theme: layout.theme,
    links: storeSocialLinks(p),
  };
}

/** The single resolver. Every storefront surface and editor preview goes through it. */
export function resolveCustomization(c: StoreCustomization): ResolvedCustomization {
  const appearance = resolveStoreAppearance(c.profile, c.theme);
  return {
    appearance,
    sectionTheme: { ...c.theme, accent: appearance.accent, text: appearance.text },
    rootStyle: {
      '--store-accent': appearance.accent,
      '--store-text': appearance.text,
      fontFamily: appearance.fontFamily,
      color: appearance.text,
    },
  };
}
