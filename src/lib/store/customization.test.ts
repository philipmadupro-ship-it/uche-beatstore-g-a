import { describe, expect, it } from 'vitest';
import { CreatorProfilePatchSchema } from '@/lib/contracts';
import { pickProvidedProfileFields } from '@/lib/profile/patch';
import { defaultStoreLayout, defaultStoreTheme, normalizeLayout } from '@/lib/store-editor/layout';
import { parseStoreTheme } from '@/lib/store-editor/theme-schema';
import {
  CUSTOMIZATION_VERSION,
  parseCustomization,
  resolveCustomization,
  resolveStoreAppearance,
  STORE_FONT_FAMILIES,
} from './customization';
import { storefrontThemeStyle } from './typography';

describe('no customization means identical output', () => {
  it('null / missing inputs resolve to the stock storefront', () => {
    for (const input of [null, undefined, {}, { profile: null, layout: null }, { layout: 'junk' }, { layout: { version: 1 } }]) {
      const c = parseCustomization(input);
      const r = resolveCustomization(c);
      expect(c.version).toBe(CUSTOMIZATION_VERSION);
      expect(c.sections.map((s) => s.id)).toEqual(defaultStoreLayout().sections.map((s) => s.id));
      expect(c.theme).toEqual(defaultStoreTheme);
      expect(r.appearance).toEqual(resolveStoreAppearance(null, defaultStoreTheme));
      expect(r.rootStyle).toEqual(storefrontThemeStyle(null, normalizeLayout(null).theme));
      expect(r.appearance).toEqual({
        accent: '#FFFFFF', text: '#FFFFFF', fontStyle: 'default', fontFamily: STORE_FONT_FAMILIES.default,
      });
    }
  });

  it('a profile-only producer resolves exactly as before', () => {
    const profile = { accent_color: '#ff0000', text_color_primary: '#eeeeee', font_style: 'mono' };
    const r = resolveCustomization(parseCustomization({ profile, layout: null }));
    expect(r.appearance).toEqual(resolveStoreAppearance(profile, normalizeLayout(null).theme));
    expect(r.rootStyle).toEqual(storefrontThemeStyle(profile, normalizeLayout(null).theme));
    expect(r.sectionTheme.accent).toBe('#ff0000');
  });

  it('a stock theme saved by Design does not override the profile', () => {
    const r = resolveCustomization(parseCustomization({
      profile: { accent_color: '#ff0000' }, layout: defaultStoreLayout(),
    }));
    expect(r.appearance.accent).toBe('#ff0000');
  });
});

describe('theme parsing is lenient', () => {
  it('coerces odd values to stock and keeps unknown keys', () => {
    const t = parseStoreTheme({
      accent: 'url(javascript:alert(1))', text: '#abc', typeScale: 9999, radius: -3,
      buttonStyle: 'neon', headingFont: 'mono', spacingScale: 'big', futureKey: { a: 1 },
    });
    expect(t.accent).toBe(defaultStoreTheme.accent);
    expect(t.text).toBe('#abc');
    expect(t.typeScale).toBe(defaultStoreTheme.typeScale);
    expect(t.radius).toBe(defaultStoreTheme.radius);
    expect(t.buttonStyle).toBe('outline');
    expect(t.headingFont).toBe('mono');
    expect(t.spacingScale).toBe(1);
    expect((t as Record<string, unknown>).futureKey).toEqual({ a: 1 });
  });

  it('keeps every value the editor can produce', () => {
    const edited = { ...defaultStoreTheme, accent: '#6DC6A4', typeScale: 20, radius: 24, borderWidth: 4, spacingScale: 0.5, shadow: 'hard' as const, buttonStyle: 'ghost' as const };
    expect(parseStoreTheme(edited)).toEqual(edited);
  });

  it('non-objects read as the stock theme', () => {
    for (const v of [null, undefined, 'x', 4, []]) expect(parseStoreTheme(v)).toEqual(defaultStoreTheme);
  });
});

describe('round trip through the /api/profile contract', () => {
  const customized = () => {
    const layout = defaultStoreLayout();
    layout.theme = { ...layout.theme, accent: '#6DC6A4', text: '#EEEEEE', radius: 12, buttonStyle: 'solid' };
    return layout;
  };
  const profile = { accent_color: '#ff0000', text_color_primary: '#dddddd', font_style: 'serif' };

  it('customize → save contract → reload → same resolved theme', () => {
    const layout = customized();
    const body = { ...profile, store_layout: layout };
    const parsed = CreatorProfilePatchSchema.parse(body);
    // What the route stores for the named fields, then what a reload reads back.
    const stored = pickProvidedProfileFields({ ...parsed }, body);
    const before = resolveCustomization(parseCustomization({ profile, layout }));
    const after = resolveCustomization(parseCustomization({ profile, layout: JSON.parse(JSON.stringify(stored.store_layout)) }));
    expect(after).toEqual(before);
    expect(after.appearance.accent).toBe('#6DC6A4');
    expect(after.appearance.fontStyle).toBe('serif');
    expect(after.sectionTheme.radius).toBe(12);
  });

  it('an already-saved layout with odd theme values still saves and round-trips', () => {
    const odd = { ...defaultStoreLayout(), theme: { accent: 'not a colour', typeScale: 500, legacy: true } as never };
    const parsed = CreatorProfilePatchSchema.safeParse({ store_layout: odd });
    expect(parsed.success).toBe(true);
    const saved = parsed.success ? parsed.data.store_layout : null;
    const again = CreatorProfilePatchSchema.parse({ store_layout: saved });
    expect(again.store_layout).toEqual(saved);
    expect(saved?.theme.typeScale).toBe(defaultStoreTheme.typeScale);
    expect(normalizeLayout(saved).theme.accent).toBe(defaultStoreTheme.accent);
    expect((saved?.theme as Record<string, unknown>).legacy).toBe(true);
  });

  it('still rejects a layout whose theme is not an object', () => {
    expect(CreatorProfilePatchSchema.safeParse({ store_layout: { version: 1, sections: [], theme: 'x' } }).success).toBe(false);
  });
});

describe('links', () => {
  it('lists only destinations the storefront would link', () => {
    const c = parseCustomization({ profile: { instagram_handle: '@u2c', website_url: 'javascript:alert(1)', spotify_url: 'https://open.spotify.com/artist/1' } });
    expect(c.links.map((l) => l.label)).toEqual(['Instagram', 'Spotify']);
  });
});

describe('write side keeps a partial theme partial', () => {
  it('does not add keys the request did not name', () => {
    const parsed = CreatorProfilePatchSchema.parse({ store_layout: { version: 1, sections: [], theme: { accent: '#c8a47a' } } });
    expect(parsed.store_layout?.theme).toEqual({ accent: '#c8a47a' });
  });
});
