import { describe, expect, it } from 'vitest';
import { defaultStoreTheme } from '@/lib/store-editor/layout';
import { normalizeThemeColor } from '@/lib/theme/colors';
import {
  effectiveStoreTheme,
  normalizeFontStyle,
  resolveStoreAppearance,
  STORE_FONT_FAMILIES,
} from './appearance';

describe('normalizeFontStyle', () => {
  it('keeps the three styles the storefront draws', () => {
    expect(normalizeFontStyle('default')).toBe('default');
    expect(normalizeFontStyle('serif')).toBe('serif');
    expect(normalizeFontStyle('mono')).toBe('mono');
  });

  it('reads the retired /profile options and junk as default', () => {
    expect(normalizeFontStyle('modern')).toBe('default');
    expect(normalizeFontStyle('minimal')).toBe('default');
    expect(normalizeFontStyle(null)).toBe('default');
    expect(normalizeFontStyle(undefined)).toBe('default');
    expect(normalizeFontStyle('')).toBe('default');
  });
});

describe('resolveStoreAppearance', () => {
  it('uses the profile when there is no layout', () => {
    const a = resolveStoreAppearance({ accent_color: '#ff0000', text_color_primary: '#eeeeee', font_style: 'mono' });
    expect(a).toEqual({
      accent: '#ff0000',
      text: '#eeeeee',
      fontStyle: 'mono',
      fontFamily: STORE_FONT_FAMILIES.mono,
    });
  });

  it('falls back to white text and the default face with an empty profile', () => {
    const a = resolveStoreAppearance(null);
    expect(a.text).toBe('#FFFFFF');
    expect(a.accent).toBe('#FFFFFF');
    expect(a.fontStyle).toBe('default');
  });

  it('keeps the profile accent when the saved theme is the stock one', () => {
    // A producer who opened Design only to reorder sections still saves a
    // full theme; that must not replace the accent they chose on /profile.
    const a = resolveStoreAppearance({ accent_color: '#ff0000' }, defaultStoreTheme);
    expect(a.accent).toBe('#ff0000');
    expect(a.text).toBe('#FFFFFF');
  });

  it('lets a changed theme accent and text win', () => {
    const a = resolveStoreAppearance(
      { accent_color: '#ff0000', text_color_primary: '#eeeeee' },
      { ...defaultStoreTheme, accent: '#6DC6A4', text: '#dddddd' },
    );
    expect(a.accent).toBe('#6DC6A4');
    expect(a.text).toBe('#dddddd');
  });

  it('compares against the stock theme case-insensitively', () => {
    const a = resolveStoreAppearance(
      { accent_color: '#ff0000', text_color_primary: '#eeeeee' },
      { accent: '#C8A47A', text: '#ffffff' },
    );
    expect(a.accent).toBe('#ff0000');
    expect(a.text).toBe('#eeeeee');
  });

  it('maps legacy beige profile accents the same way the store always has', () => {
    expect(resolveStoreAppearance({ accent_color: '#a08a6a' }).accent).toBe('rgba(255,255,255,0.8)');
  });
});

describe('effectiveStoreTheme', () => {
  it('shows the profile accent in the preview when the theme is untouched', () => {
    const t = effectiveStoreTheme(defaultStoreTheme, { accent_color: '#ff0000', text_color_primary: '#eeeeee' });
    expect(t.accent).toBe('#ff0000');
    expect(t.text).toBe('#eeeeee');
    expect(t.radius).toBe(defaultStoreTheme.radius);
  });

  it('keeps a theme the producer changed', () => {
    const t = effectiveStoreTheme({ ...defaultStoreTheme, accent: '#6DC6A4' }, { accent_color: '#ff0000' });
    expect(t.accent).toBe('#6DC6A4');
  });
});

describe('effectiveStoreTheme (STORE-07 cases)', () => {
  it('a default theme takes the profile accent and text colour', () => {
    const theme = effectiveStoreTheme(defaultStoreTheme, { accent_color: '#6DC6A4', text_color_primary: '#EEEEEE' });
    expect(theme.accent).toBe('#6DC6A4');
    expect(theme.text).toBe('#EEEEEE');
    expect(theme.radius).toBe(defaultStoreTheme.radius);
  });

  it('with no profile colours it resolves exactly as the rest of /store does', () => {
    const theme = effectiveStoreTheme(defaultStoreTheme, null);
    expect(theme.accent).toBe(normalizeThemeColor(null));
    expect(theme.text).toBe('#FFFFFF');
  });

  it('a colour changed in Design wins over the profile', () => {
    const theme = effectiveStoreTheme(
      { ...defaultStoreTheme, accent: '#ff0000', text: '#00ff00' },
      { accent_color: '#6DC6A4', text_color_primary: '#EEEEEE' },
    );
    expect(theme.accent).toBe('#ff0000');
    expect(theme.text).toBe('#00ff00');
  });

  it('a half-typed profile text colour falls back to white', () => {
    expect(effectiveStoreTheme(defaultStoreTheme, { text_color_primary: '#12' }).text).toBe('#FFFFFF');
  });
});
