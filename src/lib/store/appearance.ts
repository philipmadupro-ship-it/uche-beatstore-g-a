/**
 * Storefront appearance: which accent, text colour and font a public store
 * page is drawn in.
 *
 * Two places can set these. The profile (`/profile` and the Store Editor's
 * Content mode) stores `accent_color`, `text_color_primary` and `font_style`
 * as columns; the Store Editor's Design mode stores a theme inside
 * `store_layout`. Until this module existed `/store` read only the columns, so
 * a theme picked in Design showed in the builder's preview and nowhere else,
 * and `/store/producer/[slug]` read only the font.
 *
 * Rule: a theme value wins only when the producer actually changed it from the
 * stock theme. Every saved layout carries a full theme, so "the layout has a
 * theme" says nothing — a producer who opened Design once to reorder sections
 * would otherwise lose the accent they set on their profile.
 */

import { defaultStoreTheme, type StoreTheme } from '@/lib/store-editor/layout';
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
