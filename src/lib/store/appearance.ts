/**
 * The theme a storefront section is actually drawn with.
 *
 * Two settings surfaces own storefront colour. Content mode writes
 * `creator_profiles.accent_color` / `text_color_primary`, which every built-in
 * storefront component reads. Design mode's Theme panel writes
 * `store_layout.theme`, which only the layout's own sections (`text`, `image`,
 * `video`, `links`, `canvas`) read. Left alone, a producer who set a mint
 * accent in Content would see every button on /store in mint and their text
 * section's button in the layout default's tan — two accents on one page.
 *
 * Rule: a theme colour the producer changed in Design wins; one still at the
 * layout default defers to the profile, resolved exactly as the rest of /store
 * resolves it. The builder and /store both call this, so they agree.
 */
import { defaultStoreTheme, type StoreTheme } from '@/lib/store-editor/layout';
import { normalizeThemeColor } from '@/lib/theme/colors';
import { storeTextColor } from '@/lib/store/typography';

type ProfileColours = {
  accent_color?: string | null;
  text_color_primary?: string | null;
};

function isDefault(value: string, fallback: string): boolean {
  return value.trim().toLowerCase() === fallback.toLowerCase();
}

export function effectiveStoreTheme(theme: StoreTheme, creator: ProfileColours | null | undefined): StoreTheme {
  return {
    ...theme,
    accent: isDefault(theme.accent, defaultStoreTheme.accent)
      ? normalizeThemeColor(creator?.accent_color)
      : theme.accent,
    text: isDefault(theme.text, defaultStoreTheme.text)
      ? storeTextColor(creator?.text_color_primary)
      : theme.text,
  };
}
