import { describe, it, expect } from 'vitest';
import { FONT_FAMILY_MAP } from '@/components/store/types';
import { storeFontFamily, storeTextColor, storefrontThemeStyle } from './typography';

describe('storeFontFamily', () => {
  it('maps each editor option to its face', () => {
    expect(storeFontFamily('default')).toBe(FONT_FAMILY_MAP.default);
    expect(storeFontFamily('serif')).toContain('Synkopy');
    expect(storeFontFamily('mono')).toContain('Panchang');
  });

  it('reads missing and unknown values (the /profile page still offers `modern`) as the default face', () => {
    expect(storeFontFamily(null)).toBe(FONT_FAMILY_MAP.default);
    expect(storeFontFamily(undefined)).toBe(FONT_FAMILY_MAP.default);
    expect(storeFontFamily('modern')).toBe(FONT_FAMILY_MAP.default);
  });
});

describe('storeTextColor', () => {
  it('keeps a complete hex colour', () => {
    for (const c of ['#6DC6A4', '#fff', '#FFFFFF80', '#abcd']) expect(storeTextColor(c)).toBe(c);
    expect(storeTextColor('  #6dc6a4 ')).toBe('#6dc6a4');
  });

  it('falls back to white for empty, half-typed or non-hex input', () => {
    for (const c of [null, undefined, '', '#', '#6D', '#12345', 'red', 'url(x)', '#6DC6A4;color:red']) {
      expect(storeTextColor(c)).toBe('#FFFFFF');
    }
  });
});

describe('storefrontThemeStyle', () => {
  it('carries all three producer choices', () => {
    expect(storefrontThemeStyle({ font_style: 'mono', text_color_primary: '#6DC6A4', accent_color: '#c8a47a' })).toEqual({
      '--store-accent': '#c8a47a',
      '--store-text': '#6DC6A4',
      fontFamily: FONT_FAMILY_MAP.mono,
      color: '#6DC6A4',
    });
  });

  it('renders an unconfigured storefront exactly as before: white text, default face, white accent', () => {
    expect(storefrontThemeStyle(null)).toEqual({
      '--store-accent': '#FFFFFF',
      '--store-text': '#FFFFFF',
      fontFamily: FONT_FAMILY_MAP.default,
      color: '#FFFFFF',
    });
  });
});
