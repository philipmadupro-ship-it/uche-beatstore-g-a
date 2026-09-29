/**
 * The storefront's producer-chosen type and colour, as one style object.
 *
 * `creator_profiles.font_style`, `text_color_primary` and `accent_color` are
 * edited in the Store Editor and drawn on /store. Each surface used to derive
 * them on its own: /store applied all three, the editor's live preview applied
 * only the accent, and the Design canvas none — so picking Serif, Mono or a
 * text colour changed nothing on screen until the producer saved and opened
 * the real store. Every surface now spreads this one object on its root, so
 * the preview cannot disagree with what buyers see.
 *
 * Components consume the colours through `--store-text` / `--store-accent`
 * (see `storeTextColor`) and the face through inherited `font-family`.
 */
import type { CSSProperties } from 'react';
import { FONT_FAMILY_MAP } from '@/components/store/types';
import { normalizeThemeColor } from '@/lib/theme/colors';

export const DEFAULT_STORE_TEXT_COLOR = '#FFFFFF';

type ThemeFields = {
  font_style?: string | null;
  text_color_primary?: string | null;
  accent_color?: string | null;
};

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

/** Unknown or legacy values (`/profile` still offers `modern`/`minimal`) read as the default face. */
export function storeFontFamily(fontStyle: string | null | undefined): string {
  return FONT_FAMILY_MAP[fontStyle ?? 'default'] ?? FONT_FAMILY_MAP.default;
}

/**
 * The root style for any surface that renders the storefront: /store itself,
 * the editor's Content preview and the Design canvas.
 */
export function storefrontThemeStyle(creator: ThemeFields | null | undefined): CSSProperties {
  const accent = normalizeThemeColor(creator?.accent_color);
  const text = storeTextColor(creator?.text_color_primary);
  return {
    '--store-accent': accent,
    '--store-text': text,
    fontFamily: storeFontFamily(creator?.font_style),
    color: text,
  } as CSSProperties;
}
