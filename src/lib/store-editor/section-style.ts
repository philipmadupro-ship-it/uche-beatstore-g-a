/**
 * Copying presentation from one section to another.
 *
 * "Make this one look like that one" is a thing producers want constantly and
 * that a per-section inspector makes tedious: you re-set spacing, width and
 * alignment by hand and hope you matched them.
 *
 * Two decisions shape what a "style" actually is here:
 *
 *   - VISIBILITY IS NOT STYLE. Pasting a style must never make a section
 *     disappear. Whether a section is present is a different question from how
 *     it looks, and someone copying spacing across two strips would be
 *     astonished to find they had also hidden one on mobile.
 *   - THE TARGET DECIDES WHAT IT ACCEPTS. Paste is filtered through
 *     `sectionCapabilities`, so copying from a text block onto a hero applies
 *     only what the hero actually honours. Writing a column count onto a
 *     section whose live renderer ignores it would put a value in the document
 *     that the storefront silently disagrees with — the same fake-control
 *     failure the capability list exists to prevent.
 *
 * Pure and tested, per the repo's pure-logic rule.
 */

import {
  sectionCapabilities,
  type SectionSettings, type StoreBreakpoint, type StoreSection,
} from './layout';

/** Presentation lifted off a section, ready to apply to another. */
export type SectionStyle = {
  base: Partial<SectionSettings>;
  overrides: Partial<Record<StoreBreakpoint, Partial<SectionSettings>>>;
  /** Where it came from, for the paste affordance's label. */
  fromKind: StoreSection['kind'];
  fromName: string;
};

/** Everything a style carries. `visible` is deliberately absent — see above. */
const STYLE_KEYS: (keyof SectionSettings)[] = ['variant', 'columns', 'spacing', 'width', 'align'];

function pick(
  source: Partial<SectionSettings> | undefined,
  keys: (keyof SectionSettings)[],
): Partial<SectionSettings> {
  const out: Partial<SectionSettings> = {};
  if (!source) return out;
  for (const key of keys) {
    if (source[key] !== undefined) {
      // Index-safe assignment: the key is narrowed to a known settings key.
      (out as Record<string, unknown>)[key] = source[key];
    }
  }
  return out;
}

export function copySectionStyle(section: StoreSection): SectionStyle {
  const overrides: SectionStyle['overrides'] = {};
  for (const [breakpoint, override] of Object.entries(section.overrides ?? {})) {
    const kept = pick(override, STYLE_KEYS);
    if (Object.keys(kept).length > 0) overrides[breakpoint as StoreBreakpoint] = kept;
  }
  return {
    base: pick(section.base, STYLE_KEYS),
    overrides,
    fromKind: section.kind,
    fromName: section.name,
  };
}

/**
 * Apply a copied style, keeping only what the target can honour.
 *
 * Overrides are REPLACED for the keys the style carries and left alone
 * otherwise, so pasting a style does not silently wipe a breakpoint tweak the
 * target had for something the style says nothing about.
 */
export function applySectionStyle(section: StoreSection, style: SectionStyle): StoreSection {
  const allowed = sectionCapabilities(section.kind).filter((key) => STYLE_KEYS.includes(key));
  if (allowed.length === 0) return section;

  const base = { ...section.base, ...pick(style.base, allowed) };

  const overrides: StoreSection['overrides'] = { ...(section.overrides ?? {}) };
  for (const breakpoint of Object.keys(style.overrides) as StoreBreakpoint[]) {
    const incoming = pick(style.overrides[breakpoint], allowed);
    if (Object.keys(incoming).length === 0) continue;
    overrides[breakpoint] = { ...(overrides[breakpoint] ?? {}), ...incoming };
  }

  return { ...section, base, overrides };
}

/** Would pasting this style change anything about the target? */
export function styleAppliesTo(section: StoreSection, style: SectionStyle): boolean {
  const allowed = sectionCapabilities(section.kind).filter((key) => STYLE_KEYS.includes(key));
  if (allowed.length === 0) return false;
  return allowed.some((key) => style.base[key] !== undefined)
    || Object.values(style.overrides).some(
      (override) => allowed.some((key) => override?.[key] !== undefined),
    );
}

/** Short description for the paste button, e.g. "Paste style from Catalogue". */
export function describeStyle(style: SectionStyle): string {
  return `Paste style from ${style.fromName}`;
}
