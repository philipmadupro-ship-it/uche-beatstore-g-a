/**
 * The studio's type library.
 *
 * WHY THIS EXISTS. Font handling was spread across four places that each held a
 * partial, slightly different idea of what a "font" is: `fontStacks` in
 * `LayerView`, `fontFor()` in the SVG renderer, `fontRoleFamilies` in
 * `font-embed`, and a four-button segmented control in the inspector. They
 * disagreed, and the disagreement was visible in shipped work:
 *
 *   - The exporter wrote `font-weight:700` on every text node while the canvas
 *     set no weight at all, so the canvas drew Synkopy Regular and the export
 *     asked for a bold.
 *   - `globals.css` registers `Synkopy-Flipside.otf` AS Synkopy's 700 weight.
 *     So that same request means "the alternate cut" on the page and "please
 *     synthesise a fake bold of Regular" inside an exported SVG, which only
 *     ever embedded the 400 file.
 *   - Six of the seven Panchang cuts and both of the other shipped faces were
 *     unreachable: the picker offered four *roles*, not the eleven real files
 *     sitting in `/public/fonts`.
 *
 * So this module is the single description of what type exists, which physical
 * file backs each weight, and how a requested weight resolves when the family
 * does not have it. Both renderers and the embedder read from here.
 *
 * Everything is data plus pure functions, per the repo's pure-logic rule — the
 * weight-snapping in particular is exactly the sort of thing that silently
 * regresses when it lives inside a component.
 */

/** A face that exists as a real file we can embed, or a system fallback. */
export type CoverFontFace = {
  weight: number;
  label: string;
  /** Public path under /public/fonts. Absent for system stacks. */
  url?: string;
};

export type CoverFontCategory = 'display' | 'text' | 'mono';

export type CoverFontDefinition = {
  id: CoverFontId;
  /** Shown in the picker. */
  name: string;
  /** The `font-family` name the face is registered under in globals.css. */
  cssFamily: string;
  /** Full CSS stack, including fallbacks. */
  stack: string;
  category: CoverFontCategory;
  /** A short note on where the face earns its place. */
  hint: string;
  faces: CoverFontFace[];
  /** False for system stacks, which cannot be inlined into an export. */
  embeddable: boolean;
  /**
   * Embeddable families named after this one in `stack`.
   *
   * These get inlined alongside the primary. `embedFontsInSvg` fails soft on a
   * per-family basis, so if the 1.3 MB Synkopy fetch is the one that fails, an
   * embedded Akira is the difference between the export landing in the app's
   * own brand face and landing in whatever sans the viewer happens to have.
   */
  fallbacks: CoverFontId[];
};

export type CoverFontId =
  | 'synkopy'
  | 'akira'
  | 'panchang'
  | 'labruja'
  | 'system-sans'
  | 'system-serif'
  | 'system-mono';

/**
 * Legacy role names.
 *
 * Documents saved before the type library existed store one of these in
 * `fontFamily`. They keep resolving forever — the same reason `WaveformMode`
 * still accepts `linear` and `mirror`.
 */
export type LegacyFontRole = 'display' | 'artwork' | 'ui' | 'mono' | 'brand';

export const legacyFontRoles: Record<LegacyFontRole, CoverFontId> = {
  display: 'synkopy',
  artwork: 'synkopy',
  ui: 'system-sans',
  mono: 'panchang',
  brand: 'akira',
};

/**
 * The library.
 *
 * Every `url` here is a file that actually ships in `/public/fonts`, and every
 * weight matches the `@font-face` that `globals.css` registers for it — if
 * those two drift, the canvas and the export disagree about what a weight
 * means, which is the bug this module was written to end.
 */
export const coverFonts: CoverFontDefinition[] = [
  {
    id: 'synkopy',
    name: 'Synkopy',
    cssFamily: 'Synkopy',
    stack: "'Synkopy', 'Akira Expanded', sans-serif",
    category: 'display',
    hint: 'The app’s heading face. Flipside is its alternate cut.',
    faces: [
      { weight: 400, label: 'Regular', url: '/fonts/Synkopy-Regular.otf' },
      // Not a bold. globals.css maps the Flipside cut onto 700, so asking for
      // bold Synkopy gets you the alternate letterforms — labelled honestly
      // here rather than presented as a weight it is not.
      { weight: 700, label: 'Flipside', url: '/fonts/Synkopy-Flipside.otf' },
    ],
    embeddable: true,
    fallbacks: ['akira'],
  },
  {
    id: 'akira',
    name: 'Akira Expanded',
    cssFamily: 'Akira Expanded',
    stack: "'Akira Expanded', sans-serif",
    category: 'display',
    hint: 'The brand mark. Wide, geometric, one weight.',
    faces: [
      { weight: 400, label: 'Expanded', url: '/fonts/AkiraExpanded.otf' },
    ],
    embeddable: true,
    fallbacks: [],
  },
  {
    id: 'panchang',
    name: 'Panchang',
    cssFamily: 'Panchang',
    stack: "'Panchang', ui-monospace, monospace",
    category: 'text',
    hint: 'Seven cuts. The widest range in the library.',
    faces: [
      { weight: 200, label: 'Extralight', url: '/fonts/Panchang-Extralight.otf' },
      { weight: 300, label: 'Light', url: '/fonts/Panchang-Light.otf' },
      { weight: 400, label: 'Regular', url: '/fonts/Panchang-Regular.otf' },
      { weight: 500, label: 'Medium', url: '/fonts/Panchang-Medium.otf' },
      { weight: 600, label: 'Semibold', url: '/fonts/Panchang-Semibold.otf' },
      { weight: 700, label: 'Bold', url: '/fonts/Panchang-Bold.otf' },
      { weight: 800, label: 'Extrabold', url: '/fonts/Panchang-Extrabold.otf' },
    ],
    embeddable: true,
    fallbacks: [],
  },
  {
    id: 'labruja',
    name: 'La Bruja',
    cssFamily: 'La Bruja',
    stack: "'La Bruja', 'Synkopy', serif",
    category: 'display',
    hint: 'Script display face. Ships with the app, previously unused.',
    faces: [
      { weight: 400, label: 'Regular', url: '/fonts/LaBruja.otf' },
    ],
    embeddable: true,
    fallbacks: ['synkopy'],
  },
  {
    id: 'system-sans',
    name: 'System Sans',
    cssFamily: 'Inter',
    stack: 'Inter, system-ui, -apple-system, sans-serif',
    category: 'text',
    hint: 'Neutral fallback. Cannot be embedded — exports use the viewer’s face.',
    faces: [
      { weight: 400, label: 'Regular' },
      { weight: 600, label: 'Semibold' },
      { weight: 700, label: 'Bold' },
    ],
    embeddable: false,
    fallbacks: [],
  },
  {
    id: 'system-serif',
    name: 'System Serif',
    cssFamily: 'Georgia',
    stack: "Georgia, 'Times New Roman', serif",
    category: 'text',
    hint: 'Editorial counterweight. Not embedded.',
    faces: [
      { weight: 400, label: 'Regular' },
      { weight: 700, label: 'Bold' },
    ],
    embeddable: false,
    fallbacks: [],
  },
  {
    id: 'system-mono',
    name: 'System Mono',
    cssFamily: 'ui-monospace',
    stack: "ui-monospace, 'SF Mono', Menlo, monospace",
    category: 'mono',
    hint: 'Fixed-width metadata. Not embedded.',
    faces: [
      { weight: 400, label: 'Regular' },
      { weight: 700, label: 'Bold' },
    ],
    embeddable: false,
    fallbacks: [],
  },
];

const DEFAULT_FONT_ID: CoverFontId = 'synkopy';

/**
 * Resolve whatever a layer stores into a real font.
 *
 * Accepts a current id, a legacy role, or junk from a hand-edited document —
 * always returns a definition, never throws. A cover that fails to open because
 * of one unrecognised string is a worse outcome than a cover that opens in the
 * default face.
 */
export function resolveFont(value: string | undefined | null): CoverFontDefinition {
  if (value) {
    const direct = coverFonts.find((font) => font.id === value);
    if (direct) return direct;
    const legacy = legacyFontRoles[value as LegacyFontRole];
    if (legacy) {
      const mapped = coverFonts.find((font) => font.id === legacy);
      if (mapped) return mapped;
    }
  }
  return coverFonts.find((font) => font.id === DEFAULT_FONT_ID)!;
}

/** The CSS `font-family` value for a stored font reference. */
export function fontStackFor(value: string | undefined | null): string {
  return resolveFont(value).stack;
}

/**
 * Snap a requested weight to one the family actually has.
 *
 * This is the load-bearing function. A browser handed `font-weight: 600` for a
 * family that ships only 400 and 700 will synthesise something — and it does
 * not synthesise identically on a page with the real `@font-face` rules and
 * inside an isolated SVG with an inlined subset. Snapping first means both
 * surfaces are asked for a weight that exists, so both draw the same file.
 *
 * Ties resolve downward: between a 300 and a 500 for a requested 400, the
 * lighter cut is the safer default for display type.
 */
export function nearestFace(font: CoverFontDefinition, weight: number): CoverFontFace {
  if (font.faces.length === 0) return { weight: 400, label: 'Regular' };
  return font.faces.reduce((best, face) => {
    const bestDistance = Math.abs(best.weight - weight);
    const faceDistance = Math.abs(face.weight - weight);
    if (faceDistance < bestDistance) return face;
    if (faceDistance === bestDistance && face.weight < best.weight) return face;
    return best;
  });
}

/** The weight that will actually be rendered for a stored font + weight pair. */
export function resolveWeight(value: string | undefined | null, weight: number | undefined): number {
  return nearestFace(resolveFont(value), weight ?? 400).weight;
}

/** Every face in the library that can be inlined into an export. */
export function embeddableFaces(): { family: string; url: string; weight: number }[] {
  return coverFonts
    .filter((font) => font.embeddable)
    .flatMap((font) => font.faces
      .filter((face): face is CoverFontFace & { url: string } => Boolean(face.url))
      .map((face) => ({ family: font.cssFamily, url: face.url, weight: face.weight })));
}

/**
 * The exact faces a set of (font, weight) requests needs embedded.
 *
 * Deduplicated by family+weight, because a cover with a title and a subtitle in
 * the same cut must not inline the file twice — Synkopy alone is 1.3 MB.
 */
export function facesFor(
  requests: { font: string | undefined | null; weight: number | undefined }[],
): { family: string; url: string; weight: number }[] {
  const seen = new Map<string, { family: string; url: string; weight: number }>();

  const add = (font: CoverFontDefinition, weight: number) => {
    if (!font.embeddable) return;
    const face = nearestFace(font, weight);
    if (!face.url) return;
    const key = `${font.cssFamily}:${face.weight}`;
    if (!seen.has(key)) {
      seen.set(key, { family: font.cssFamily, url: face.url, weight: face.weight });
    }
  };

  for (const request of requests) {
    const font = resolveFont(request.font);
    add(font, request.weight ?? 400);
    // Fallbacks go in at their own regular weight — they exist to catch a
    // failed fetch of the primary, and a fallback in the wrong cut is still
    // enormously better than dropping to a system sans.
    for (const fallbackId of font.fallbacks) {
      const fallback = coverFonts.find((candidate) => candidate.id === fallbackId);
      if (fallback) add(fallback, 400);
    }
  }
  return [...seen.values()];
}

/** Grouped for the picker UI. */
export function fontsByCategory(): { category: CoverFontCategory; label: string; fonts: CoverFontDefinition[] }[] {
  const labels: Record<CoverFontCategory, string> = {
    display: 'Display',
    text: 'Text',
    mono: 'Mono',
  };
  return (['display', 'text', 'mono'] as CoverFontCategory[])
    .map((category) => ({
      category,
      label: labels[category],
      fonts: coverFonts.filter((font) => font.category === category),
    }))
    .filter((group) => group.fonts.length > 0);
}
