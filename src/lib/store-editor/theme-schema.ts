/**
 * The storefront theme: its type, its stock values and a lenient parser.
 *
 * Lives apart from `layout.ts` so the API contract can validate a theme without
 * importing the whole layout model (and so `layout.ts` can use the parser
 * without a cycle).
 *
 * Lenient on purpose: a stored theme is a producer's live storefront. A value
 * that is out of range or not a colour is coerced to the stock value instead of
 * rejecting the save, so a row written by an older build, or a hand-rolled
 * request, keeps saving and round-tripping. Unknown keys are kept.
 */
import { z } from 'zod';

export const STORE_FONT_SLOTS = ['heading', 'body', 'mono'] as const;
export type StoreFontSlot = (typeof STORE_FONT_SLOTS)[number];
export const STORE_BUTTON_STYLES = ['solid', 'outline', 'ghost'] as const;
export type StoreButtonStyle = (typeof STORE_BUTTON_STYLES)[number];
export const STORE_SHADOWS = ['none', 'soft', 'hard'] as const;
export type StoreShadow = (typeof STORE_SHADOWS)[number];

export type StoreTheme = {
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  headingFont: StoreFontSlot;
  bodyFont: StoreFontSlot;
  /** Base type size in px; every section scales from it. */
  typeScale: number;
  radius: number;
  borderWidth: number;
  /** Multiplier on the spacing steps. */
  spacingScale: number;
  buttonStyle: StoreButtonStyle;
  shadow: StoreShadow;
};

/**
 * The theme that reproduces the storefront as it looks today.
 *
 * These are the app's documented tokens — near-black surfaces, white-at-alpha
 * text, tan accent — rather than a fresh palette, so an untouched storefront
 * is byte-for-byte the current design and "open the editor" is not a restyle.
 */
export const defaultStoreTheme: StoreTheme = {
  accent: '#c8a47a',
  background: '#090907',
  surface: '#0D0D0A',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.6)',
  border: 'rgba(255,255,255,0.1)',
  headingFont: 'heading',
  bodyFont: 'body',
  typeScale: 14,
  radius: 0,
  borderWidth: 1,
  spacingScale: 1,
  buttonStyle: 'outline',
  shadow: 'none',
};

/** Hex, `rgb()/rgba()/hsl()/hsla()` or a plain colour word — what a picker or field produces. */
const CSS_COLOR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([0-9a-z.,%\s/+-]{1,60}\)|[a-z]{3,24})$/i;

export function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && CSS_COLOR.test(value.trim());
}

const color = (fallback: string) =>
  z.string().refine(isCssColor).transform((v) => v.trim()).catch(fallback);
const choice = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).catch(fallback);
const range = (min: number, max: number, fallback: number) =>
  z.number().finite().min(min).max(max).catch(fallback);

const d = defaultStoreTheme;

/** Every field falls back to the stock value; unknown keys pass through. */
export const StoreThemeSchema = z
  .object({
    accent: color(d.accent),
    background: color(d.background),
    surface: color(d.surface),
    text: color(d.text),
    muted: color(d.muted),
    border: color(d.border),
    headingFont: choice(STORE_FONT_SLOTS, d.headingFont),
    bodyFont: choice(STORE_FONT_SLOTS, d.bodyFont),
    typeScale: range(10, 24, d.typeScale),
    radius: range(0, 48, d.radius),
    borderWidth: range(0, 8, d.borderWidth),
    spacingScale: range(0.25, 4, d.spacingScale),
    buttonStyle: choice(STORE_BUTTON_STYLES, d.buttonStyle),
    shadow: choice(STORE_SHADOWS, d.shadow),
  })
  .passthrough();

/**
 * The WRITE-side form: coerce only the keys that are present and leave absent
 * ones absent, so a partial theme saves as sent (the read side, `normalizeLayout`,
 * fills the rest). Objects only; the caller has already required one.
 */
export function sanitizeStoreTheme(value: Record<string, unknown>): Record<string, unknown> {
  const full = StoreThemeSchema.parse(value) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = key in THEME_KEYS ? full[key] : value[key];
  return out;
}

const THEME_KEYS: Record<string, true> = Object.fromEntries(
  Object.keys(StoreThemeSchema.shape).map((k) => [k, true as const]),
);

/** Anything → a complete theme. Null, arrays and non-objects read as the stock theme. */
export function parseStoreTheme(value: unknown): StoreTheme {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return StoreThemeSchema.parse(input) as StoreTheme;
}
