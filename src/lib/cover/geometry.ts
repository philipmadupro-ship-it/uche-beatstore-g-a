/**
 * Direct-manipulation geometry for the cover art studio.
 *
 * Pure and framework-free on purpose. Resize-with-rotation, snapping and
 * rotation-with-modifier are the parts of an editor that feel broken the
 * instant the arithmetic is slightly off, and they are impossible to test from
 * inside a pointer-event handler. Per CLAUDE.md this kind of logic lives in
 * `lib/` with Vitest around it rather than inline in a React component.
 *
 * Units are document units (the artboard is 3000x3000), never screen pixels.
 * Callers divide pointer deltas by the current zoom before calling in.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Nothing may be resized smaller than this; a zero-size layer is unclickable. */
export const MIN_LAYER_SIZE = 24;

const DEG = Math.PI / 180;

function rotatePoint(x: number, y: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * Where a handle's opposite corner sits, in 0..1 of the rect.
 *
 * Resizing keeps this anchor pinned in world space, which is what makes
 * dragging the south-east handle grow the box away from a stationary
 * north-west corner instead of sliding the whole layer around.
 */
function anchorFor(handle: ResizeHandle): { u: number; v: number } {
  switch (handle) {
    case 'nw': return { u: 1, v: 1 };
    case 'n': return { u: 0.5, v: 1 };
    case 'ne': return { u: 0, v: 1 };
    case 'e': return { u: 0, v: 0.5 };
    case 'se': return { u: 0, v: 0 };
    case 's': return { u: 0.5, v: 0 };
    case 'sw': return { u: 1, v: 0 };
    case 'w': return { u: 1, v: 0.5 };
  }
}

const affectsWidth: Record<ResizeHandle, -1 | 0 | 1> = {
  nw: -1, n: 0, ne: 1, e: 1, se: 1, s: 0, sw: -1, w: -1,
};

const affectsHeight: Record<ResizeHandle, -1 | 0 | 1> = {
  nw: -1, n: -1, ne: -1, e: 0, se: 1, s: 1, sw: 1, w: 0,
};

export type ResizeOptions = {
  rect: Rect;
  handle: ResizeHandle;
  /** Pointer movement since the drag started, in document units. */
  dx: number;
  dy: number;
  /** Layer rotation in degrees. */
  rotation?: number;
  /** Shift-drag: keep the original aspect ratio. */
  aspectLocked?: boolean;
  /** Alt-drag: grow symmetrically about the centre instead of from the anchor. */
  fromCenter?: boolean;
};

/**
 * Resize a rect by dragging one handle.
 *
 * The pointer delta is rotated into the layer's own frame first, so dragging
 * the right edge of a layer rotated 45 degrees widens it along its own axis
 * rather than along the screen's. The anchor is then restored to the world
 * position it had before the resize, which is what stops a rotated layer from
 * drifting as you scale it.
 */
export function resizeRect({
  rect, handle, dx, dy, rotation = 0, aspectLocked = false, fromCenter = false,
}: ResizeOptions): Rect {
  const radians = rotation * DEG;
  const local = rotatePoint(dx, dy, -radians);

  const wSign = affectsWidth[handle];
  const hSign = affectsHeight[handle];
  const growth = fromCenter ? 2 : 1;

  let width = rect.width + wSign * local.x * growth;
  let height = rect.height + hSign * local.y * growth;

  if (aspectLocked && rect.width > 0 && rect.height > 0) {
    const aspect = rect.width / rect.height;
    if (wSign === 0) {
      width = height * aspect;
    } else if (hSign === 0) {
      height = width / aspect;
    } else {
      // Corner drag: let whichever axis the pointer moved further along drive
      // the other, so the box tracks the cursor rather than fighting it.
      const relW = Math.abs(width / rect.width - 1);
      const relH = Math.abs(height / rect.height - 1);
      if (relW >= relH) height = width / aspect;
      else width = height * aspect;
    }
  }

  width = Math.max(MIN_LAYER_SIZE, width);
  height = Math.max(MIN_LAYER_SIZE, height);

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  if (fromCenter) {
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
  }

  const anchor = anchorFor(handle);
  // Anchor in world space before the resize.
  const beforeLocal = { x: anchor.u * rect.width - rect.width / 2, y: anchor.v * rect.height - rect.height / 2 };
  const beforeWorld = rotatePoint(beforeLocal.x, beforeLocal.y, radians);
  const anchorX = centerX + beforeWorld.x;
  const anchorY = centerY + beforeWorld.y;

  // Where the centre has to be for that same anchor to stay put.
  const afterLocal = { x: anchor.u * width - width / 2, y: anchor.v * height - height / 2 };
  const afterWorld = rotatePoint(afterLocal.x, afterLocal.y, radians);

  return {
    x: anchorX - afterWorld.x - width / 2,
    y: anchorY - afterWorld.y - height / 2,
    width,
    height,
  };
}

/* ── Snapping ──────────────────────────────────────────────────────────── */

export type SnapTargets = { vertical: number[]; horizontal: number[] };

export type SnapResult = {
  x: number;
  y: number;
  /** Guide lines that matched, so the canvas can draw them. */
  guides: { vertical: number[]; horizontal: number[] };
};

/**
 * Snap lines available to a dragged layer: the artboard's edges and centre,
 * plus every other visible layer's edges and centre.
 *
 * The dragged layers are excluded so a layer never snaps to itself, and hidden
 * layers are excluded because snapping to something you cannot see reads as the
 * canvas jumping for no reason.
 */
export function collectSnapTargets(
  artboard: { width: number; height: number },
  layers: Array<Rect & { id: string; visible: boolean }>,
  excludeIds: string[] = [],
  /**
   * Ruler guides. A guide the producer placed deliberately is a stronger
   * intention than an incidental alignment with another layer, so they join
   * the same target set rather than living in a separate pass — `snapRect`
   * already picks the nearest line, and a guide that only snapped when no
   * layer edge was nearby would feel unreliable.
   */
  guides: { x: number[]; y: number[] } = { x: [], y: [] },
): SnapTargets {
  const excluded = new Set(excludeIds);
  const vertical = [0, artboard.width / 2, artboard.width, ...guides.x];
  const horizontal = [0, artboard.height / 2, artboard.height, ...guides.y];

  layers.forEach((layer) => {
    if (excluded.has(layer.id) || !layer.visible) return;
    vertical.push(layer.x, layer.x + layer.width / 2, layer.x + layer.width);
    horizontal.push(layer.y, layer.y + layer.height / 2, layer.y + layer.height);
  });

  return {
    vertical: [...new Set(vertical)].sort((a, b) => a - b),
    horizontal: [...new Set(horizontal)].sort((a, b) => a - b),
  };
}

/**
 * Nudge a rect onto the nearest snap line within `threshold`.
 *
 * All three of a rect's edges compete on each axis and the closest one wins, so
 * a box snaps by whichever edge you brought near a guide — the behaviour that
 * makes alignment feel automatic rather than like a fight.
 */
export function snapRect(rect: Rect, targets: SnapTargets, threshold = 18): SnapResult {
  const result: SnapResult = { x: rect.x, y: rect.y, guides: { vertical: [], horizontal: [] } };

  const axis = (
    start: number,
    size: number,
    lines: number[],
  ): { value: number; guide: number | null } => {
    let best: { delta: number; line: number } | null = null;
    const edges = [start, start + size / 2, start + size];
    edges.forEach((edge) => {
      lines.forEach((line) => {
        const delta = line - edge;
        if (Math.abs(delta) > threshold) return;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line };
      });
    });
    const hit = best as { delta: number; line: number } | null;
    return hit ? { value: start + hit.delta, guide: hit.line } : { value: start, guide: null };
  };

  const x = axis(rect.x, rect.width, targets.vertical);
  const y = axis(rect.y, rect.height, targets.horizontal);

  result.x = x.value;
  result.y = y.value;
  if (x.guide !== null) result.guides.vertical.push(x.guide);
  if (y.guide !== null) result.guides.horizontal.push(y.guide);
  return result;
}

/* ── Rotation ──────────────────────────────────────────────────────────── */

/**
 * Angle in degrees from a rect's centre to a pointer.
 *
 * `snapTo` is applied when the caller passes it (shift-drag), giving the 15
 * degree detents every design tool has.
 *
 * Normalised to (-180, 180] rather than 0..360, which is what the inspector's
 * rotation slider spans. Layers can legitimately carry a small negative angle —
 * the scatter collage layout produces them — so a 0..360 range would clamp a
 * tile sitting at -8 degrees to 0 and silently straighten it.
 */
export function rotationFromPointer(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  snapTo = 0,
): number {
  const raw = Math.atan2(pointer.y - center.y, pointer.x - center.x) / DEG + 90;
  const snapped = snapTo > 0 ? Math.round(raw / snapTo) * snapTo : raw;
  return normalizeRotation(snapped);
}

/** Fold any angle into (-180, 180]. */
export function normalizeRotation(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Bounding box around several rects — the frame drawn for a multi-selection. */
export function selectionBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Do two rects overlap at all? Used by marquee selection. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Normalise a drag between two points into a positive-size rect. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Largest rect of `aspect` that fits inside `bounds`, centred.
 *
 * Used when an image is dropped on the canvas: the layer takes the image's own
 * proportions instead of a forced square, so a landscape photo does not arrive
 * pre-cropped.
 */
export function fitRectInside(bounds: Rect, aspect: number): Rect {
  const boundsAspect = bounds.width / bounds.height;
  const width = aspect >= boundsAspect ? bounds.width : bounds.height * aspect;
  const height = aspect >= boundsAspect ? bounds.width / aspect : bounds.height;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

/** Keep a rect from being dragged entirely off the artboard. */
export function clampToArtboard(rect: Rect, artboard: { width: number; height: number }, keepVisible = 48): Rect {
  return {
    ...rect,
    x: Math.min(artboard.width - keepVisible, Math.max(keepVisible - rect.width, rect.x)),
    y: Math.min(artboard.height - keepVisible, Math.max(keepVisible - rect.height, rect.y)),
  };
}

/**
 * Reposition a rect so it keeps its place inside a box that has been resized.
 *
 * This is what makes a multi-selection scale as one object: the selection's
 * bounding box is resized by the usual handle maths, then every member is
 * mapped through this so relative positions and proportions inside the group
 * survive. Resizing each layer independently would pull the composition apart.
 *
 * A zero-width or zero-height source box would divide by zero, so those
 * degenerate cases pass the rect through with only its origin moved.
 */
export function scaleRectWithin(rect: Rect, from: Rect, to: Rect): Rect {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (rect.x - from.x) * scaleX,
    y: to.y + (rect.y - from.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/**
 * The single factor to scale a type size by when a group is resized.
 *
 * The geometric mean of the two axes, so a group stretched twice as wide and
 * half as tall leaves type the size it was rather than picking one axis
 * arbitrarily and doubling or halving it.
 */
export function uniformScaleFactor(from: Rect, to: Rect): number {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return Math.sqrt(Math.abs(scaleX * scaleY)) || 1;
}
