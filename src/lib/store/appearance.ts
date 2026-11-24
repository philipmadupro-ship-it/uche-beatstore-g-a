/**
 * Storefront appearance. The implementation lives in `./customization` (the
 * versioned customization protocol); this module keeps the original exports.
 */
export {
  STORE_FONT_STYLES,
  STORE_FONT_LABELS,
  STORE_FONT_FAMILIES,
  DEFAULT_STORE_TEXT_COLOR,
  normalizeFontStyle,
  storeTextColor,
  resolveStoreAppearance,
  effectiveStoreTheme,
} from './customization';
export type { StoreFontStyle, StoreAppearanceProfile, StoreAppearance } from './customization';
