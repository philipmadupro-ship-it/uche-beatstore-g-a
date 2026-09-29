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
 * Which values win (profile columns vs. a Design theme colour the producer
 * changed) is decided once, in `lib/store/appearance.ts`; this module only
 * turns that answer into CSS.
 *
 * Components consume the colours through `--store-text` / `--store-accent`
 * (see `storeTextColor`) and the face through inherited `font-family`.
 */
import type { CSSProperties } from 'react';
import type { StoreTheme } from '@/lib/store-editor/layout';
import {
  DEFAULT_STORE_TEXT_COLOR,
  normalizeFontStyle,
  resolveStoreAppearance,
  storeTextColor,
  STORE_FONT_FAMILIES,
  type StoreAppearance,
  type StoreAppearanceProfile,
} from './appearance';

export { DEFAULT_STORE_TEXT_COLOR, storeTextColor };

/** Unknown or legacy values (`modern` / `minimal`) read as the default face. */
export function storeFontFamily(fontStyle: string | null | undefined): string {
  return STORE_FONT_FAMILIES[normalizeFontStyle(fontStyle)];
}

/** The root style for an already-resolved appearance. */
export function appearanceStyle(appearance: StoreAppearance): CSSProperties {
  return {
    '--store-accent': appearance.accent,
    '--store-text': appearance.text,
    fontFamily: appearance.fontFamily,
    color: appearance.text,
  } as CSSProperties;
}

/**
 * The root style for any surface that renders the storefront: /store itself,
 * the producer page, the editor's Content preview and the Design canvas.
 * Pass the layout's theme wherever one exists, or a colour changed in Design
 * shows in the builder and nowhere else.
 */
export function storefrontThemeStyle(
  creator: StoreAppearanceProfile | null | undefined,
  theme?: Partial<StoreTheme> | null,
): CSSProperties {
  return appearanceStyle(resolveStoreAppearance(creator, theme));
}
