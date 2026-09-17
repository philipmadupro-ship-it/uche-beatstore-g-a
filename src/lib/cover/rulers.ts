/**
 * Rulers and guides.
 *
 * Two jobs that are really one: telling you where you are in the document, and
 * letting you pin a line to work against.
 *
 * The interesting part is tick spacing. A ruler with a fixed step is useless at
 * both ends of a zoom range — at 8% every label overlaps into mush, at 200%
 * there are three ticks on screen. So the step is chosen from the value of the
 * zoom, always landing on a "nice" number (1, 2 or 5 times a power of ten)
 * because 250 and 500 are numbers a person can hold and 437 is not.
 *
 * GUIDES ARE EDITOR STATE THAT LIVES ON THE DOCUMENT. They persist with the
 * artwork — a producer who set up a margin guide expects it next time — but
 * they are never drawn by `renderArtworkDocumentSvg`. That is by construction
 * rather than by a flag: the exporter simply does not read `guides`, so no
 * future edit can accidentally bake a magenta line into a cover.
 *
 * Pure and tested, per the repo's pure-logic rule.
 */

export type RulerTick = {
  /** Position in document units. */
  position: number;
  /** Majors carry a label and a full-height mark. */
  major: boolean;
  label: string | null;
};

/** The 1-2-5 sequence, which is what every ruler and axis in existence uses. */
const NICE_MULTIPLES = [1, 2, 5];

/**
 * The smallest "nice" number at or above `minimum`.
 *
 * Walking powers of ten and trying 1/2/5 at each is both exact and obvious;
 * a log-based shortcut gets floating-point wrong at the boundaries (a
 * `minimum` of exactly 100 must return 100, not 200).
 */
export function niceStep(minimum: number): number {
  if (!Number.isFinite(minimum) || minimum <= 0) return 1;
  let magnitude = 10 ** Math.floor(Math.log10(minimum));
  // Guard the boundary case where floating point puts the magnitude one decade
  // low — e.g. log10(1000) coming back as 2.9999999999999996.
  if (magnitude * 10 <= minimum) magnitude *= 10;
  for (let scale = magnitude; scale <= magnitude * 100; scale *= 10) {
    for (const multiple of NICE_MULTIPLES) {
      const candidate = multiple * scale;
      if (candidate >= minimum - 1e-9) return candidate;
    }
  }
  return magnitude * 10;
}

/** Pixels a major tick should be apart on screen before the labels crowd. */
export const MIN_MAJOR_PIXELS = 72;
/**
 * Minors per major. Five is the division a ruler is read in.
 *
 * No "are the minors too dense?" guard is needed, and one written here was
 * dead code: `rulerStep` already guarantees majors are at least
 * MIN_MAJOR_PIXELS apart, so minors are at least a fifth of that — about 14px
 * at every zoom. The spacing floor is a property of the step, not a separate
 * thing to check.
 */
const SUBDIVISIONS = 5;

/** Document units between major ticks at this zoom. */
export function rulerStep(zoom: number, minPixels = MIN_MAJOR_PIXELS): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return niceStep(minPixels);
  return niceStep(minPixels / zoom);
}

export function formatRulerLabel(value: number): string {
  // Whole document units. A cover is measured in pixels, and "1500" is more
  // use to someone matching a crop than "1.5k".
  return String(Math.round(value));
}

/**
 * Ticks across a document axis.
 *
 * Includes both ends, so the ruler always brackets the artboard rather than
 * trailing off wherever the step happened to land.
 */
export function rulerTicks(documentLength: number, zoom: number): RulerTick[] {
  if (!Number.isFinite(documentLength) || documentLength <= 0) return [];
  const major = rulerStep(zoom);
  const step = major / SUBDIVISIONS;

  const ticks: RulerTick[] = [];
  const count = Math.floor(documentLength / step);
  for (let index = 0; index <= count; index += 1) {
    const position = index * step;
    const isMajor = Math.abs(position % major) < 1e-6;
    ticks.push({
      position,
      major: isMajor,
      label: isMajor ? formatRulerLabel(position) : null,
    });
  }
  // The far edge matters more than the rhythm — a 3000px board must show 3000.
  const last = ticks[ticks.length - 1];
  if (!last || Math.abs(last.position - documentLength) > 1e-6) {
    ticks.push({
      position: documentLength,
      major: true,
      label: formatRulerLabel(documentLength),
    });
  }
  return ticks;
}

/* ── Guides ─────────────────────────────────────────────────────────────── */

export type GuideAxis = 'x' | 'y';

export type DocumentGuides = {
  /** Vertical lines, at these x positions. */
  x: number[];
  /** Horizontal lines, at these y positions. */
  y: number[];
};

export const emptyGuides: DocumentGuides = { x: [], y: [] };

/**
 * Single place that decides what "no guides" means, matching the
 * `imageCropDefaults` pattern — documents saved before guides existed keep
 * opening, and every consumer gets concrete arrays rather than undefined.
 */
export function guidesDefaults(guides: Partial<DocumentGuides> | undefined | null): DocumentGuides {
  return {
    x: Array.isArray(guides?.x) ? guides.x.filter(Number.isFinite) : [],
    y: Array.isArray(guides?.y) ? guides.y.filter(Number.isFinite) : [],
  };
}

/** How close two guides must be, in document units, to count as the same one. */
export const GUIDE_TOLERANCE = 2;

export function addGuide(
  guides: DocumentGuides,
  axis: GuideAxis,
  position: number,
  max: number,
): DocumentGuides {
  if (!Number.isFinite(position)) return guides;
  const clamped = Math.round(Math.min(max, Math.max(0, position)));
  // Dropping a guide onto one that already exists should be a no-op rather
  // than stacking two lines nobody can tell apart or drag independently.
  if (guides[axis].some((existing) => Math.abs(existing - clamped) <= GUIDE_TOLERANCE)) return guides;
  return { ...guides, [axis]: [...guides[axis], clamped].sort((a, b) => a - b) };
}

export function removeGuide(guides: DocumentGuides, axis: GuideAxis, position: number): DocumentGuides {
  const next = guides[axis].filter((existing) => Math.abs(existing - position) > GUIDE_TOLERANCE);
  if (next.length === guides[axis].length) return guides;
  return { ...guides, [axis]: next };
}

/**
 * Drag a guide to a new position.
 *
 * Dragging one guide onto another removes the one being dragged rather than
 * leaving two stacked lines — the same reasoning as `addGuide`, applied to the
 * gesture that would otherwise create the duplicate.
 */
export function moveGuide(
  guides: DocumentGuides,
  axis: GuideAxis,
  from: number,
  to: number,
  max: number,
): DocumentGuides {
  const without = removeGuide(guides, axis, from);
  return addGuide(without, axis, to, max);
}

/** The guide within `tolerance` of a position, for hit-testing a drag. */
export function guideNear(
  guides: DocumentGuides,
  axis: GuideAxis,
  position: number,
  tolerance: number,
): number | null {
  let best: { guide: number; distance: number } | null = null;
  for (const guide of guides[axis]) {
    const distance = Math.abs(guide - position);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { guide, distance };
    }
  }
  return best ? best.guide : null;
}

export function clearGuides(): DocumentGuides {
  return { x: [], y: [] };
}

export function guideCount(guides: DocumentGuides): number {
  return guides.x.length + guides.y.length;
}
