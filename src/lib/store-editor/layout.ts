/**
 * The storefront layout document.
 *
 * The Store Editor was an accordion of forms: fourteen collapsible panels, a
 * Save button for some fields and immediate writes for others, and a preview
 * that showed the hero and three cards. You could change what the storefront
 * CONTAINED but not how it was composed — order, spacing, which blocks appear
 * on a phone — because that lived in JSX.
 *
 * This module makes composition data. A layout is an ordered list of SECTIONS,
 * each backed by a real, already-tested storefront component, plus a theme.
 *
 * WHY SECTIONS RATHER THAN FREE-FORM BOXES. `/store` is the page that takes
 * money. It is server-rendered, edge-cached, faceted, and has to stay usable on
 * a phone and legible to a crawler. Absolute x/y positioning would put all four
 * of those properties in the hands of whoever last dragged something. Sections
 * keep the document expressive — reorder, hide, restyle, per-breakpoint — while
 * the responsive and accessible behaviour stays inside components that were
 * built and tested for it. Free-form placement is available where it cannot do
 * damage: inside a `canvas` section, which is bounded by its own frame.
 *
 * Everything here is pure and tested. Per CLAUDE.md, layout resolution living
 * inside a component is exactly what gets silently reverted.
 */

export const storeBreakpoints = ['desktop', 'tablet', 'mobile'] as const;
export type StoreBreakpoint = (typeof storeBreakpoints)[number];

/** Editing widths for each device. Real device widths, not round numbers. */
export const breakpointWidths: Record<StoreBreakpoint, number> = {
  desktop: 1440,
  tablet: 834,
  mobile: 390,
};

/**
 * Section kinds.
 *
 * Every one except `text`/`image`/`video`/`canvas` maps onto a component the
 * storefront already renders today, which is what keeps this a re-composition
 * of working code rather than a parallel implementation of the store.
 */
export const storeSectionKinds = [
  'hero',
  'countdown',
  'featured-projects',
  'featured-playlists',
  'spotlight',
  'producer-picks',
  'catalog',
  'trust',
  'text',
  'image',
  'video',
  'links',
  'canvas',
] as const;

export type StoreSectionKind = (typeof storeSectionKinds)[number];

export type SectionWidth = 'full' | 'wide' | 'narrow';
export type SectionAlign = 'left' | 'center' | 'right';

/**
 * What a section looks like at one breakpoint.
 *
 * Deliberately small. Each field is something a producer can reason about and
 * every storefront section can honour — a section-specific knob belongs in
 * `content`, not here, or the type becomes a union of everything.
 */
export type SectionSettings = {
  visible: boolean;
  /** Per-kind presentation, e.g. catalog `grid` vs `list`. */
  variant: string;
  /** Grid columns where the section renders a grid. */
  columns: number;
  /** Vertical rhythm, in steps of the spacing scale (0–8). */
  spacing: number;
  width: SectionWidth;
  align: SectionAlign;
};

export const defaultSectionSettings: SectionSettings = {
  visible: true,
  variant: 'default',
  columns: 4,
  spacing: 4,
  width: 'wide',
  align: 'left',
};

/** Free-text/media payloads for the sections that carry their own content. */
export type SectionContent = {
  heading?: string;
  body?: string;
  imageUrl?: string;
  videoUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** Free-form children, only for `canvas` sections. Percentages of the frame. */
  blocks?: CanvasBlock[];
};

/**
 * A free-form block inside a `canvas` section.
 *
 * Positions are PERCENTAGES of the section frame rather than pixels, so a
 * hand-placed composition still reflows sensibly across device widths instead
 * of hanging off the side of a phone. This is the bounded form of the free-form
 * placement the brief asked for: it can look like anything inside its own
 * frame, and it cannot break the page around it.
 */
export type CanvasBlock = {
  id: string;
  kind: 'text' | 'image' | 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  imageUrl?: string;
  color?: string;
  fontSize?: number;
  align?: SectionAlign;
};

export type StoreSection = {
  id: string;
  kind: StoreSectionKind;
  /** Producer-facing name. Renamable. */
  name: string;
  locked: boolean;
  /** Settings that apply unless a breakpoint overrides them. */
  base: SectionSettings;
  /**
   * Per-breakpoint overrides, sparse on purpose.
   *
   * Storing only what differs is what makes "mobile stacks the tracklist"
   * expressible without duplicating every other field — and it means a change
   * to a base value still reaches every breakpoint that has not been
   * deliberately overridden, which is the behaviour people expect.
   */
  overrides: Partial<Record<StoreBreakpoint, Partial<SectionSettings>>>;
  content?: SectionContent;
};

export type StoreTheme = {
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  headingFont: 'heading' | 'body' | 'mono';
  bodyFont: 'heading' | 'body' | 'mono';
  /** Base type size in px; every section scales from it. */
  typeScale: number;
  radius: number;
  borderWidth: number;
  /** Multiplier on the spacing steps. */
  spacingScale: number;
  buttonStyle: 'solid' | 'outline' | 'ghost';
  shadow: 'none' | 'soft' | 'hard';
};

export type StoreLayout = {
  version: number;
  sections: StoreSection[];
  theme: StoreTheme;
  updatedAt: string;
};

export const LAYOUT_VERSION = 1;

/* ── Defaults ───────────────────────────────────────────────────────────── */

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

type SectionSeed = {
  kind: StoreSectionKind;
  name: string;
  base?: Partial<SectionSettings>;
  overrides?: Partial<Record<StoreBreakpoint, Partial<SectionSettings>>>;
  locked?: boolean;
};

/**
 * The default layout mirrors what `/store` renders right now, in order.
 *
 * That equivalence is the safety property of this whole feature: a producer
 * who never opens the editor, and one who opens it and changes nothing, both
 * get exactly the page they have today.
 */
const defaultSeeds: SectionSeed[] = [
  {
    kind: 'hero',
    name: 'Hero',
    base: { width: 'full', spacing: 0 },
    // The particle-text producer name is expensive and reads poorly at phone
    // width, so mobile gets the plain variant.
    overrides: { mobile: { variant: 'plain' } },
  },
  { kind: 'countdown', name: 'Next drop', base: { width: 'wide', spacing: 2 } },
  { kind: 'featured-projects', name: 'Projects', base: { columns: 3, spacing: 4 }, overrides: { tablet: { columns: 2 }, mobile: { columns: 1 } } },
  { kind: 'featured-playlists', name: 'Playlists', base: { columns: 4, spacing: 4 }, overrides: { tablet: { columns: 3 }, mobile: { columns: 2 } } },
  { kind: 'spotlight', name: 'Spotlight', base: { spacing: 4 } },
  { kind: 'producer-picks', name: "Producer's Picks", base: { columns: 4, spacing: 4 }, overrides: { tablet: { columns: 3 }, mobile: { columns: 2 } } },
  {
    kind: 'catalog',
    name: 'Catalogue',
    // The catalogue is the shop. It can be restyled and reordered but not
    // hidden or deleted by accident, so it ships locked.
    locked: true,
    base: { variant: 'list', columns: 4, spacing: 4, width: 'full' },
    overrides: { mobile: { variant: 'grid', columns: 2 } },
  },
  { kind: 'trust', name: 'Trust badges', base: { width: 'full', spacing: 3 } },
];

let idCounter = 0;

/** Stable-ish id. Prefixed so a section id is recognisable in stored JSON. */
export function createSectionId(kind: StoreSectionKind): string {
  idCounter += 1;
  return `sec-${kind}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createSection(kind: StoreSectionKind, name?: string, base?: Partial<SectionSettings>): StoreSection {
  return {
    id: createSectionId(kind),
    kind,
    name: name ?? kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    locked: false,
    base: { ...defaultSectionSettings, ...base },
    overrides: {},
  };
}

export function defaultStoreLayout(): StoreLayout {
  return {
    version: LAYOUT_VERSION,
    sections: defaultSeeds.map((seed) => ({
      ...createSection(seed.kind, seed.name, seed.base),
      locked: seed.locked ?? false,
      overrides: seed.overrides ?? {},
    })),
    theme: { ...defaultStoreTheme },
    updatedAt: new Date().toISOString(),
  };
}

/* ── Resolution ─────────────────────────────────────────────────────────── */

/**
 * The settings actually in force for a section at a breakpoint.
 *
 * The load-bearing function of the whole feature, and the reason overrides are
 * sparse: base first, then only the keys this breakpoint names. An override of
 * `{ columns: 1 }` must not reset spacing, alignment or visibility to defaults,
 * which is exactly what a naive object replace would do.
 */
export function resolveSection(section: StoreSection, breakpoint: StoreBreakpoint): SectionSettings {
  return {
    ...defaultSectionSettings,
    ...section.base,
    ...(section.overrides[breakpoint] ?? {}),
  };
}

/** Does this breakpoint change anything for this section? */
export function hasOverride(section: StoreSection, breakpoint: StoreBreakpoint): boolean {
  const override = section.overrides[breakpoint];
  if (!override) return false;
  return Object.keys(override).length > 0;
}

/** Which specific fields a breakpoint overrides — used to badge the inspector. */
export function overriddenKeys(section: StoreSection, breakpoint: StoreBreakpoint): (keyof SectionSettings)[] {
  return Object.keys(section.overrides[breakpoint] ?? {}) as (keyof SectionSettings)[];
}

/**
 * Write a setting at a breakpoint.
 *
 * Editing on `desktop` writes the BASE rather than a desktop override. Desktop
 * is the canonical design; treating it as just another override would mean a
 * layout whose base nothing ever reads, and every tablet/mobile value would
 * stop inheriting the change.
 */
export function setSectionSetting<K extends keyof SectionSettings>(
  section: StoreSection,
  breakpoint: StoreBreakpoint,
  key: K,
  value: SectionSettings[K],
): StoreSection {
  if (breakpoint === 'desktop') {
    return { ...section, base: { ...section.base, [key]: value } };
  }
  return {
    ...section,
    overrides: {
      ...section.overrides,
      [breakpoint]: { ...(section.overrides[breakpoint] ?? {}), [key]: value },
    },
  };
}

/** Drop one overridden field so it inherits again. */
export function clearSectionOverride(
  section: StoreSection,
  breakpoint: StoreBreakpoint,
  key: keyof SectionSettings,
): StoreSection {
  const current = section.overrides[breakpoint];
  if (!current || !(key in current)) return section;
  const next = { ...current };
  delete next[key];
  const overrides = { ...section.overrides };
  if (Object.keys(next).length === 0) delete overrides[breakpoint];
  else overrides[breakpoint] = next;
  return { ...section, overrides };
}

/** Drop every override for a breakpoint. */
export function clearBreakpoint(section: StoreSection, breakpoint: StoreBreakpoint): StoreSection {
  if (!section.overrides[breakpoint]) return section;
  const overrides = { ...section.overrides };
  delete overrides[breakpoint];
  return { ...section, overrides };
}

/* ── Capabilities ───────────────────────────────────────────────────────── */

/**
 * Which settings a section kind actually honours.
 *
 * This exists to keep the inspector honest. The data-backed sections render
 * through storefront components that own their own internal grid — the
 * featured strips and the beat cards decide their own column counts across
 * breakpoints, and they are tested that way. Offering a "columns" control that
 * the live page then ignores would be a fake control, which is worse than not
 * offering it: the producer sets it, the preview obeys, the storefront does
 * not, and the editor has quietly lied.
 *
 * So a control appears only where the layout genuinely drives the result.
 * `visible`, `spacing` and `width` are applied by the wrapper the storefront
 * puts around every section, so they work for every kind.
 */
export type SectionCapability = keyof SectionSettings;

export function sectionCapabilities(kind: StoreSectionKind): SectionCapability[] {
  switch (kind) {
    case 'hero':
      // The particle-vs-plain title is a real prop on ArtistBioBlock.
      return ['visible', 'variant'];
    case 'catalog':
      // The layout supplies the DEFAULT grid/list mode. Buyers can still flip
      // it themselves, and their choice wins once they have made one.
      return ['visible', 'variant'];
    case 'text':
    case 'image':
    case 'video':
    case 'links':
    case 'canvas':
      // Rendered by this feature's own code on both surfaces, so the full set
      // applies — these are the sections the layout genuinely lays out.
      return ['visible', 'spacing', 'width', 'align', 'columns'];
    default:
      // countdown / featured strips / spotlight / picks / trust all render
      // through storefront components that own their own internal padding and
      // responsive grid. Order and visibility are what the layout controls;
      // offering spacing or columns here would be a control the live page
      // quietly ignores.
      return ['visible'];
  }
}

export function supportsSetting(kind: StoreSectionKind, key: SectionCapability): boolean {
  return sectionCapabilities(kind).includes(key);
}

/**
 * Tailwind classes that hide a section at the breakpoints it is hidden on.
 *
 * The storefront is ONE tree, not three, so per-breakpoint visibility has to
 * become CSS rather than a JS branch — otherwise it could not be server
 * rendered or edge cached, and a crawler would see whatever the server guessed.
 *
 * The editor's device widths map onto Tailwind's scale as: mobile below `md`
 * (768), tablet from `md` to `lg` (768–1023), desktop `lg` and up.
 */
export function visibilityClasses(section: StoreSection): string {
  const classes: string[] = [];
  if (!resolveSection(section, 'mobile').visible) classes.push('max-md:hidden');
  if (!resolveSection(section, 'tablet').visible) classes.push('md:max-lg:hidden');
  if (!resolveSection(section, 'desktop').visible) classes.push('lg:hidden');
  return classes.join(' ');
}

/** True when a section is hidden at every breakpoint — skip rendering entirely. */
export function isFullyHidden(section: StoreSection): boolean {
  return storeBreakpoints.every((point) => !resolveSection(section, point).visible);
}

/* ── Document operations ────────────────────────────────────────────────── */

/**
 * Sections pinned to the end of the page.
 *
 * The catalogue owns the sticky filter toolbar that sits directly above it —
 * separating them, or putting the shop above the hero, produces a page that is
 * broken rather than merely unusual. The trust rail is a footer element for the
 * same reason.
 *
 * Rather than offer a drag that the live storefront would quietly ignore, the
 * document itself refuses to move them, and the builder shows them as pinned.
 * That keeps the preview and the storefront describing the same page, which is
 * the property this whole feature depends on.
 */
const PINNED_KINDS: readonly StoreSectionKind[] = ['catalog', 'trust'];

export function isPinnedSection(kind: StoreSectionKind): boolean {
  return PINNED_KINDS.includes(kind);
}

/** Index of the first pinned section — the ceiling for everything movable. */
function pinnedBoundary(layout: StoreLayout): number {
  const index = layout.sections.findIndex((section) => isPinnedSection(section.kind));
  return index === -1 ? layout.sections.length : index;
}

export function moveSection(layout: StoreLayout, id: string, delta: number): StoreLayout {
  const index = layout.sections.findIndex((section) => section.id === id);
  if (index === -1) return layout;
  if (isPinnedSection(layout.sections[index].kind)) return layout;
  const target = index + delta;
  if (target < 0 || target >= pinnedBoundary(layout)) return layout;
  const sections = [...layout.sections];
  const [moved] = sections.splice(index, 1);
  sections.splice(target, 0, moved);
  return { ...layout, sections };
}

/** Move a section to an absolute index — the drag-and-drop path. */
export function reorderSection(layout: StoreLayout, id: string, toIndex: number): StoreLayout {
  const index = layout.sections.findIndex((section) => section.id === id);
  if (index === -1) return layout;
  if (isPinnedSection(layout.sections[index].kind)) return layout;
  // Clamped below the pinned run, so a drag cannot drop a promo strip
  // underneath the catalogue where the storefront would not render it.
  const clamped = Math.min(pinnedBoundary(layout) - 1, Math.max(0, toIndex));
  if (clamped === index) return layout;
  const sections = [...layout.sections];
  const [moved] = sections.splice(index, 1);
  sections.splice(clamped, 0, moved);
  return { ...layout, sections };
}

export function updateSection(
  layout: StoreLayout,
  id: string,
  mutate: (section: StoreSection) => StoreSection,
): StoreLayout {
  return {
    ...layout,
    sections: layout.sections.map((section) => (section.id === id ? mutate(section) : section)),
  };
}

export function addSection(layout: StoreLayout, section: StoreSection, atIndex?: number): StoreLayout {
  const sections = [...layout.sections];
  // A new section defaults to the end of the MOVABLE run rather than the end
  // of the document, so "Add section" never buries it under the catalogue.
  const ceiling = pinnedBoundary(layout);
  const index = atIndex === undefined ? ceiling : Math.min(ceiling, Math.max(0, atIndex));
  sections.splice(index, 0, section);
  return { ...layout, sections };
}

/** Locked sections resist deletion, the same way a locked layer does. */
export function removeSection(layout: StoreLayout, id: string): StoreLayout {
  const section = layout.sections.find((item) => item.id === id);
  if (!section || section.locked) return layout;
  return { ...layout, sections: layout.sections.filter((item) => item.id !== id) };
}

export function duplicateSection(layout: StoreLayout, id: string): { layout: StoreLayout; id: string | null } {
  const index = layout.sections.findIndex((section) => section.id === id);
  if (index === -1) return { layout, id: null };
  const source = layout.sections[index];
  const clone: StoreSection = {
    ...structuredCloneSafe(source),
    id: createSectionId(source.kind),
    name: `${source.name} copy`,
    // A duplicate you cannot immediately move or delete is a trap.
    locked: false,
  };
  const sections = [...layout.sections];
  sections.splice(index + 1, 0, clone);
  return { layout: { ...layout, sections }, id: clone.id };
}

/**
 * Deep copy without depending on `structuredClone` being present.
 *
 * jsdom in the test environment has historically lacked it, and a duplicate
 * that shares its `overrides` object with the original is a bug that only
 * shows up later, when editing the copy silently edits the source too.
 */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ── Validation ─────────────────────────────────────────────────────────── */

/**
 * Accept a stored layout, or reject it entirely.
 *
 * A half-valid layout is worse than none: the storefront would render some
 * sections and silently drop others. Anything that fails here falls back to the
 * default layout, which is the current live page.
 */
export function isStoreLayout(value: unknown): value is StoreLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<StoreLayout>;
  if (typeof layout.version !== 'number') return false;
  if (!Array.isArray(layout.sections)) return false;
  if (!layout.theme || typeof layout.theme !== 'object') return false;
  return layout.sections.every((section) => (
    section
    && typeof section === 'object'
    && typeof section.id === 'string'
    && typeof section.kind === 'string'
    && (storeSectionKinds as readonly string[]).includes(section.kind)
    && typeof section.base === 'object'
    && section.base !== null
  ));
}

/**
 * Coerce a stored layout into something renderable.
 *
 * Unknown section kinds are dropped rather than rendered as a hole, and missing
 * theme keys fall back to the defaults, so a layout saved by an older version
 * keeps opening after new theme fields are added.
 */
export function normalizeLayout(value: unknown): StoreLayout {
  if (!isStoreLayout(value)) return defaultStoreLayout();
  return {
    version: LAYOUT_VERSION,
    sections: value.sections
      .filter((section) => (storeSectionKinds as readonly string[]).includes(section.kind))
      .map((section) => ({
        ...section,
        name: section.name ?? section.kind,
        locked: Boolean(section.locked),
        base: { ...defaultSectionSettings, ...section.base },
        overrides: section.overrides ?? {},
      })),
    theme: { ...defaultStoreTheme, ...value.theme },
    updatedAt: value.updatedAt ?? new Date().toISOString(),
  };
}
