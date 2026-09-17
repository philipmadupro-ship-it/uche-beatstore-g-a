import { describe, expect, it } from 'vitest';
import {
  LAYOUT_VERSION, addSection, breakpointWidths, clearBreakpoint, clearSectionOverride,
  createSection, defaultSectionSettings, defaultStoreLayout, defaultStoreTheme,
  duplicateSection, hasOverride, isStoreLayout, moveSection, normalizeLayout,
  overriddenKeys, removeSection, reorderSection, resolveSection, sectionCapabilities,
  setSectionSetting, storeBreakpoints, storeSectionKinds, supportsSetting, updateSection,
  visibilityClasses, isFullyHidden, isPinnedSection,
} from './layout';

describe('the default layout', () => {
  it('is valid by its own validator', () => {
    expect(isStoreLayout(defaultStoreLayout())).toBe(true);
  });

  it('gives every section a unique id', () => {
    const ids = defaultStoreLayout().sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leads with the hero and ends with the trust rail, mirroring /store today', () => {
    const kinds = defaultStoreLayout().sections.map((section) => section.kind);
    expect(kinds[0]).toBe('hero');
    expect(kinds.at(-1)).toBe('trust');
    expect(kinds).toContain('catalog');
  });

  it('locks the catalogue, because it is the shop', () => {
    const catalog = defaultStoreLayout().sections.find((section) => section.kind === 'catalog');
    expect(catalog?.locked).toBe(true);
  });

  it('starts every section visible', () => {
    for (const section of defaultStoreLayout().sections) {
      expect(resolveSection(section, 'desktop').visible).toBe(true);
    }
  });

  it('uses the app’s documented tokens rather than a fresh palette', () => {
    // An untouched storefront must be the page that exists today; opening the
    // editor is not supposed to be a restyle.
    expect(defaultStoreTheme.background).toBe('#090907');
    expect(defaultStoreTheme.surface).toBe('#0D0D0A');
    expect(defaultStoreTheme.accent).toBe('#c8a47a');
  });

  it('gives each device a real width', () => {
    expect(breakpointWidths.desktop).toBeGreaterThan(breakpointWidths.tablet);
    expect(breakpointWidths.tablet).toBeGreaterThan(breakpointWidths.mobile);
  });
});

describe('resolveSection', () => {
  it('returns the base when nothing is overridden', () => {
    const section = createSection('catalog', 'Catalogue', { columns: 4, variant: 'grid' });
    expect(resolveSection(section, 'mobile')).toMatchObject({ columns: 4, variant: 'grid' });
  });

  it('applies only the keys a breakpoint names', () => {
    // The bug this guards: replacing the settings object wholesale would reset
    // spacing, width and visibility to defaults the moment someone set columns.
    const section = {
      ...createSection('catalog', 'Catalogue', {
        columns: 4, variant: 'grid', spacing: 6, align: 'center' as const,
      }),
      overrides: { mobile: { columns: 1 } },
    };
    const mobile = resolveSection(section, 'mobile');
    expect(mobile.columns).toBe(1);
    expect(mobile.variant).toBe('grid');
    expect(mobile.spacing).toBe(6);
    expect(mobile.align).toBe('center');
  });

  it('keeps breakpoints independent', () => {
    const section = {
      ...createSection('catalog'),
      overrides: { mobile: { columns: 1 }, tablet: { columns: 2 } },
    };
    expect(resolveSection(section, 'mobile').columns).toBe(1);
    expect(resolveSection(section, 'tablet').columns).toBe(2);
    expect(resolveSection(section, 'desktop').columns).toBe(defaultSectionSettings.columns);
  });

  it('fills in any field missing from a partially-stored base', () => {
    const section = { ...createSection('hero'), base: { columns: 2 } as never };
    expect(resolveSection(section, 'desktop').visible).toBe(true);
    expect(resolveSection(section, 'desktop').width).toBe(defaultSectionSettings.width);
  });

  it('resolves every default section at every breakpoint without gaps', () => {
    for (const section of defaultStoreLayout().sections) {
      for (const breakpoint of storeBreakpoints) {
        const resolved = resolveSection(section, breakpoint);
        expect(typeof resolved.visible).toBe('boolean');
        expect(typeof resolved.variant).toBe('string');
        expect(Number.isFinite(resolved.columns)).toBe(true);
      }
    }
  });

  it('reproduces the intended responsive behaviour of the default catalogue', () => {
    const catalog = defaultStoreLayout().sections.find((section) => section.kind === 'catalog')!;
    expect(resolveSection(catalog, 'desktop').variant).toBe('list');
    expect(resolveSection(catalog, 'mobile').variant).toBe('grid');
    expect(resolveSection(catalog, 'mobile').columns).toBe(2);
  });
});

describe('setSectionSetting', () => {
  it('writes the BASE when editing on desktop', () => {
    // Desktop is the canonical design. Writing a desktop override instead
    // would leave a base nothing reads and stop tablet/mobile inheriting.
    const section = setSectionSetting(createSection('catalog'), 'desktop', 'columns', 6);
    expect(section.base.columns).toBe(6);
    expect(section.overrides.desktop).toBeUndefined();
  });

  it('lets a desktop edit flow through to breakpoints that have not overridden it', () => {
    let section = createSection('catalog');
    section = setSectionSetting(section, 'mobile', 'variant', 'grid');
    section = setSectionSetting(section, 'desktop', 'columns', 6);
    expect(resolveSection(section, 'mobile').columns).toBe(6);
    expect(resolveSection(section, 'mobile').variant).toBe('grid');
  });

  it('writes an override for tablet and mobile', () => {
    const section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    expect(section.base.columns).toBe(defaultSectionSettings.columns);
    expect(section.overrides.mobile).toEqual({ columns: 1 });
  });

  it('merges rather than replaces existing overrides', () => {
    let section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    section = setSectionSetting(section, 'mobile', 'spacing', 2);
    expect(section.overrides.mobile).toEqual({ columns: 1, spacing: 2 });
  });

  it('does not mutate the section it is given', () => {
    const section = createSection('catalog');
    const before = JSON.stringify(section);
    setSectionSetting(section, 'mobile', 'columns', 1);
    expect(JSON.stringify(section)).toBe(before);
  });
});

describe('override bookkeeping', () => {
  it('reports whether a breakpoint changes anything', () => {
    const plain = createSection('catalog');
    expect(hasOverride(plain, 'mobile')).toBe(false);
    expect(hasOverride(setSectionSetting(plain, 'mobile', 'columns', 1), 'mobile')).toBe(true);
  });

  it('lists exactly which fields are overridden', () => {
    let section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    section = setSectionSetting(section, 'mobile', 'variant', 'grid');
    expect(overriddenKeys(section, 'mobile').sort()).toEqual(['columns', 'variant']);
    expect(overriddenKeys(section, 'tablet')).toEqual([]);
  });

  it('clears one field back to inheriting', () => {
    let section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    section = setSectionSetting(section, 'mobile', 'spacing', 2);
    section = clearSectionOverride(section, 'mobile', 'columns');
    expect(section.overrides.mobile).toEqual({ spacing: 2 });
    expect(resolveSection(section, 'mobile').columns).toBe(defaultSectionSettings.columns);
  });

  it('removes the breakpoint entry entirely once its last field is cleared', () => {
    let section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    section = clearSectionOverride(section, 'mobile', 'columns');
    expect(section.overrides.mobile).toBeUndefined();
  });

  it('is a no-op when clearing something that was never overridden', () => {
    const section = createSection('catalog');
    expect(clearSectionOverride(section, 'mobile', 'columns')).toBe(section);
  });

  it('clears a whole breakpoint at once', () => {
    let section = setSectionSetting(createSection('catalog'), 'mobile', 'columns', 1);
    section = setSectionSetting(section, 'mobile', 'spacing', 2);
    expect(clearBreakpoint(section, 'mobile').overrides.mobile).toBeUndefined();
  });
});

describe('document operations', () => {
  it('moves a section up and down', () => {
    const layout = defaultStoreLayout();
    const second = layout.sections[1].id;
    expect(moveSection(layout, second, -1).sections[0].id).toBe(second);
    expect(moveSection(layout, second, 1).sections[2].id).toBe(second);
  });

  it('refuses to move past either end', () => {
    const layout = defaultStoreLayout();
    expect(moveSection(layout, layout.sections[0].id, -1)).toBe(layout);
    expect(moveSection(layout, layout.sections.at(-1)!.id, 1)).toBe(layout);
  });

  it('reorders to an absolute index', () => {
    const layout = defaultStoreLayout();
    const id = layout.sections[0].id;
    expect(reorderSection(layout, id, 3).sections[3].id).toBe(id);
  });

  it('clamps an out-of-range reorder rather than losing the section', () => {
    const layout = defaultStoreLayout();
    const id = layout.sections[0].id;
    const next = reorderSection(layout, id, 999);
    expect(next.sections).toHaveLength(layout.sections.length);
    // Clamped to the last MOVABLE slot rather than the literal end — the
    // catalogue and trust rail are pinned, so nothing may land beneath them.
    const catalogIndex = next.sections.findIndex((section) => section.kind === 'catalog');
    expect(next.sections[catalogIndex - 1].id).toBe(id);
  });

  it('adds a section at a position', () => {
    const layout = defaultStoreLayout();
    const section = createSection('text', 'About');
    const next = addSection(layout, section, 1);
    expect(next.sections[1].id).toBe(section.id);
    expect(next.sections).toHaveLength(layout.sections.length + 1);
  });

  it('adds to the end of the MOVABLE run, not under the catalogue', () => {
    // Appending to the literal end would bury every new section beneath the
    // shop and the trust rail, where the storefront does not render it.
    const layout = defaultStoreLayout();
    const section = createSection('text');
    const next = addSection(layout, section);
    const index = next.sections.findIndex((item) => item.id === section.id);
    const catalogIndex = next.sections.findIndex((item) => item.kind === 'catalog');
    expect(index).toBeLessThan(catalogIndex);
  });

  it('removes an unlocked section', () => {
    const layout = defaultStoreLayout();
    const hero = layout.sections.find((section) => section.kind === 'hero')!;
    expect(removeSection(layout, hero.id).sections.find((s) => s.id === hero.id)).toBeUndefined();
  });

  it('refuses to remove a locked section', () => {
    const layout = defaultStoreLayout();
    const catalog = layout.sections.find((section) => section.kind === 'catalog')!;
    expect(removeSection(layout, catalog.id)).toBe(layout);
  });

  it('duplicates with a fresh id, a new name and no lock', () => {
    const layout = defaultStoreLayout();
    const catalog = layout.sections.find((section) => section.kind === 'catalog')!;
    const { layout: next, id } = duplicateSection(layout, catalog.id);
    const clone = next.sections.find((section) => section.id === id)!;
    expect(clone.id).not.toBe(catalog.id);
    expect(clone.name).toBe(`${catalog.name} copy`);
    expect(clone.locked).toBe(false);
  });

  it('places a duplicate directly after its source', () => {
    const layout = defaultStoreLayout();
    const first = layout.sections[0];
    const { layout: next, id } = duplicateSection(layout, first.id);
    expect(next.sections[1].id).toBe(id);
  });

  it('deep-copies a duplicate so editing the copy cannot reach the original', () => {
    let layout = defaultStoreLayout();
    const target = layout.sections[0];
    layout = updateSection(layout, target.id, (section) => setSectionSetting(section, 'mobile', 'columns', 1));
    const { layout: next, id } = duplicateSection(layout, target.id);
    const withClone = updateSection(next, id!, (section) => setSectionSetting(section, 'mobile', 'columns', 3));
    const original = withClone.sections.find((section) => section.id === target.id)!;
    expect(resolveSection(original, 'mobile').columns).toBe(1);
  });

  it('returns a null id when duplicating something that does not exist', () => {
    const layout = defaultStoreLayout();
    expect(duplicateSection(layout, 'nope').id).toBeNull();
  });

  it('updates one section without touching the others', () => {
    const layout = defaultStoreLayout();
    const target = layout.sections[2];
    const next = updateSection(layout, target.id, (section) => ({ ...section, name: 'Renamed' }));
    expect(next.sections[2].name).toBe('Renamed');
    expect(next.sections[0]).toBe(layout.sections[0]);
  });
});

describe('validation and normalisation', () => {
  it('rejects junk', () => {
    expect(isStoreLayout(null)).toBe(false);
    expect(isStoreLayout('a string')).toBe(false);
    expect(isStoreLayout({})).toBe(false);
    expect(isStoreLayout({ version: 1, sections: 'nope', theme: {} })).toBe(false);
  });

  it('rejects a layout containing an unknown section kind', () => {
    expect(isStoreLayout({
      version: 1,
      theme: {},
      sections: [{ id: 'a', kind: 'not-a-kind', base: {} }],
    })).toBe(false);
  });

  it('falls back to the default rather than throwing on junk', () => {
    // A storefront that fails to render is far worse than one that renders
    // the current design.
    expect(normalizeLayout(undefined).sections.length).toBeGreaterThan(0);
    expect(normalizeLayout({ nonsense: true }).sections[0].kind).toBe('hero');
  });

  it('fills in theme keys added since the layout was saved', () => {
    const stored = { ...defaultStoreLayout(), theme: { accent: '#ff0000' } as never };
    const normalized = normalizeLayout(stored);
    expect(normalized.theme.accent).toBe('#ff0000');
    expect(normalized.theme.background).toBe(defaultStoreTheme.background);
  });

  it('drops an unknown section kind rather than rendering a hole', () => {
    const stored = defaultStoreLayout();
    const withJunk = {
      ...stored,
      sections: [...stored.sections, { id: 'x', kind: 'ghost', base: {}, overrides: {} }],
    };
    // The validator rejects the whole thing, so normalise gives the default —
    // either way nothing unknown reaches the renderer.
    expect(normalizeLayout(withJunk).sections.every(
      (section) => (storeSectionKinds as readonly string[]).includes(section.kind),
    )).toBe(true);
  });

  it('round-trips a real layout through JSON unchanged', () => {
    const layout = defaultStoreLayout();
    const round = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(round.sections.map((s) => s.kind)).toEqual(layout.sections.map((s) => s.kind));
    expect(round.theme).toEqual(layout.theme);
    expect(round.version).toBe(LAYOUT_VERSION);
  });

  it('preserves overrides through a round trip', () => {
    let layout = defaultStoreLayout();
    const id = layout.sections[0].id;
    layout = updateSection(layout, id, (section) => setSectionSetting(section, 'mobile', 'columns', 1));
    const round = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(resolveSection(round.sections[0], 'mobile').columns).toBe(1);
  });
});

describe('section capabilities', () => {
  it('lets every kind be shown or hidden', () => {
    for (const kind of storeSectionKinds) {
      expect(sectionCapabilities(kind), `${kind} must support visibility`).toContain('visible');
    }
  });

  it('offers spacing and width only where the layout does the laying out', () => {
    // The storefront components own their own padding and responsive grid, so
    // a spacing control on them would be obeyed by the preview and ignored by
    // the live page — the exact fake-control failure this guards against.
    expect(supportsSetting('text', 'spacing')).toBe(true);
    expect(supportsSetting('canvas', 'width')).toBe(true);
    expect(supportsSetting('hero', 'spacing')).toBe(false);
    expect(supportsSetting('spotlight', 'width')).toBe(false);
    expect(supportsSetting('trust', 'spacing')).toBe(false);
  });

  it('offers a layout variant only where one exists', () => {
    expect(supportsSetting('hero', 'variant')).toBe(true);
    expect(supportsSetting('catalog', 'variant')).toBe(true);
    // These render through storefront components with no variant prop, so a
    // variant control would be a lie the live page exposes after publishing.
    expect(supportsSetting('spotlight', 'variant')).toBe(false);
    expect(supportsSetting('trust', 'variant')).toBe(false);
    expect(supportsSetting('countdown', 'variant')).toBe(false);
  });

  it('offers columns only where the layout actually draws the grid', () => {
    expect(supportsSetting('text', 'columns')).toBe(true);
    // The featured strips and the beat grid own their own responsive column
    // counts, and they are tested that way.
    expect(supportsSetting('catalog', 'columns')).toBe(false);
    expect(supportsSetting('featured-projects', 'columns')).toBe(false);
    expect(supportsSetting('featured-playlists', 'columns')).toBe(false);
    expect(supportsSetting('producer-picks', 'columns')).toBe(false);
  });

  it('offers alignment only for sections whose content this feature renders', () => {
    expect(supportsSetting('text', 'align')).toBe(true);
    expect(supportsSetting('links', 'align')).toBe(true);
    expect(supportsSetting('hero', 'align')).toBe(false);
  });

  it('never reports a capability outside the settings type', () => {
    const valid = Object.keys(defaultSectionSettings);
    for (const kind of storeSectionKinds) {
      for (const capability of sectionCapabilities(kind)) {
        expect(valid).toContain(capability);
      }
    }
  });
});

describe('visibilityClasses', () => {
  it('emits nothing when a section is visible everywhere', () => {
    expect(visibilityClasses(createSection('text'))).toBe('');
  });

  it('hides only the breakpoint that is switched off', () => {
    const section = setSectionSetting(createSection('text'), 'mobile', 'visible', false);
    expect(visibilityClasses(section)).toBe('max-md:hidden');
  });

  it('hides tablet with a bounded range so desktop is unaffected', () => {
    const section = setSectionSetting(createSection('text'), 'tablet', 'visible', false);
    expect(visibilityClasses(section)).toBe('md:max-lg:hidden');
  });

  it('hides desktop when the base is off but a breakpoint overrides it back on', () => {
    let section = setSectionSetting(createSection('text'), 'desktop', 'visible', false);
    section = setSectionSetting(section, 'mobile', 'visible', true);
    const classes = visibilityClasses(section);
    expect(classes).toContain('lg:hidden');
    expect(classes).toContain('md:max-lg:hidden');
    expect(classes).not.toContain('max-md:hidden');
  });

  it('combines several hidden breakpoints', () => {
    let section = setSectionSetting(createSection('text'), 'mobile', 'visible', false);
    section = setSectionSetting(section, 'tablet', 'visible', false);
    expect(visibilityClasses(section).split(' ').sort()).toEqual(['max-md:hidden', 'md:max-lg:hidden']);
  });
});

describe('isFullyHidden', () => {
  it('is false while any breakpoint still shows the section', () => {
    const section = setSectionSetting(createSection('text'), 'mobile', 'visible', false);
    expect(isFullyHidden(section)).toBe(false);
  });

  it('is true only when every breakpoint is off', () => {
    // Turning the base off switches every breakpoint that has not overridden it.
    const section = setSectionSetting(createSection('text'), 'desktop', 'visible', false);
    expect(isFullyHidden(section)).toBe(true);
  });
});

describe('pinned sections', () => {
  it('pins the catalogue and the trust rail', () => {
    expect(isPinnedSection('catalog')).toBe(true);
    expect(isPinnedSection('trust')).toBe(true);
    expect(isPinnedSection('hero')).toBe(false);
    expect(isPinnedSection('text')).toBe(false);
  });

  it('refuses to move a pinned section', () => {
    const layout = defaultStoreLayout();
    const catalog = layout.sections.find((section) => section.kind === 'catalog')!;
    expect(moveSection(layout, catalog.id, -1)).toBe(layout);
    expect(reorderSection(layout, catalog.id, 0)).toBe(layout);
  });

  it('refuses to move an unpinned section past the pinned run', () => {
    // The catalogue owns the sticky filter toolbar directly above it; dropping
    // a promo strip below the shop would render somewhere the storefront has
    // no slot for.
    const layout = defaultStoreLayout();
    const hero = layout.sections.find((section) => section.kind === 'hero')!;
    const next = reorderSection(layout, hero.id, layout.sections.length - 1);
    const heroIndex = next.sections.findIndex((section) => section.id === hero.id);
    const catalogIndex = next.sections.findIndex((section) => section.kind === 'catalog');
    expect(heroIndex).toBeLessThan(catalogIndex);
  });

  it('still reorders freely within the movable run', () => {
    const layout = defaultStoreLayout();
    const hero = layout.sections.find((section) => section.kind === 'hero')!;
    const next = reorderSection(layout, hero.id, 3);
    expect(next.sections.findIndex((section) => section.id === hero.id)).toBe(3);
  });

  it('keeps the pinned sections last after any legal reorder', () => {
    let layout = defaultStoreLayout();
    const movable = layout.sections.filter((section) => !isPinnedSection(section.kind));
    for (const section of movable) {
      layout = reorderSection(layout, section.id, 0);
    }
    const kinds = layout.sections.map((section) => section.kind);
    expect(kinds.at(-2)).toBe('catalog');
    expect(kinds.at(-1)).toBe('trust');
  });
});

describe('the default layout reproduces the storefront as it shipped', () => {
  /**
   * The safety property of this whole feature. `/store` renders its sections
   * from this layout now, so if the default drifts from the order the page
   * used to hardcode, every producer who has never opened the builder gets a
   * silently rearranged storefront.
   */
  it('lists the movable sections in the order /store rendered them', () => {
    const movable = defaultStoreLayout().sections
      .filter((section) => !isPinnedSection(section.kind))
      .map((section) => section.kind);
    expect(movable).toEqual([
      'hero',
      'countdown',
      'featured-projects',
      'featured-playlists',
      'spotlight',
      'producer-picks',
    ]);
  });

  it('pins the catalogue above the trust rail, at the end', () => {
    const kinds = defaultStoreLayout().sections.map((section) => section.kind);
    expect(kinds.slice(-2)).toEqual(['catalog', 'trust']);
  });

  it('shows every section on every device out of the box', () => {
    for (const section of defaultStoreLayout().sections) {
      expect(visibilityClasses(section), `${section.kind} is hidden by default`).toBe('');
      expect(isFullyHidden(section)).toBe(false);
    }
  });

  it('keeps the particle hero on desktop and drops it only on mobile', () => {
    const hero = defaultStoreLayout().sections.find((section) => section.kind === 'hero')!;
    expect(resolveSection(hero, 'desktop').variant).toBe('default');
    expect(resolveSection(hero, 'tablet').variant).toBe('default');
    expect(resolveSection(hero, 'mobile').variant).toBe('plain');
  });
});
