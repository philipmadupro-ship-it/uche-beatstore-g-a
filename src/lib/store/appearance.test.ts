import { describe, expect, it } from 'vitest';
import { effectiveStoreTheme } from './appearance';
import { defaultStoreTheme } from '@/lib/store-editor/layout';
import { normalizeThemeColor } from '@/lib/theme/colors';

describe('effectiveStoreTheme', () => {
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
