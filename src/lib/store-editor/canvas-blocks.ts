/**
 * Free-form blocks inside a `canvas` section.
 *
 * This is the bounded form of the free-form placement the brief asked for. The
 * storefront as a whole stays a section document — reorderable, responsive,
 * server-renderable — and arbitrary placement lives inside one section's frame,
 * where it can look like anything and still cannot break the page around it.
 *
 * POSITIONS ARE PERCENTAGES OF THE FRAME, never pixels. A block placed at
 * "62% across" means the same thing on a 1440px desktop and a 390px phone,
 * which is what stops a hand-composed panel from hanging off the side of a
 * handset. It also means the drag maths needs no knowledge of the builder's
 * zoom: a scaled element's `getBoundingClientRect()` is already in screen
 * pixels, so a ratio taken against it comes out right at any zoom.
 *
 * Pure and tested, per the repo's pure-logic rule.
 */

import type { CanvasBlock, SectionAlign } from './layout';

export const canvasBlockKinds = ['text', 'image', 'shape'] as const;
export type CanvasBlockKind = (typeof canvasBlockKinds)[number];

/** Nothing may be smaller than this, in percent — a 0-sized block is ungrabbable. */
export const MIN_BLOCK_SIZE = 4;

let counter = 0;

export function createCanvasBlock(kind: CanvasBlockKind): CanvasBlock {
  counter += 1;
  const id = `blk-${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
  const base = { id, kind, x: 10, y: 10, width: 40, height: 20 };
  if (kind === 'text') {
    return { ...base, text: 'New text', fontSize: 18, align: 'left' as SectionAlign, color: '#FFFFFF' };
  }
  if (kind === 'shape') {
    return { ...base, height: 12, color: '#c8a47a' };
  }
  return { ...base, height: 30, imageUrl: '' };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  // Whole percent. A stored 43.8271604938 is noise nobody can act on, and it
  // makes the JSON bigger for no gain.
  return Math.round(value * 10) / 10;
}

/**
 * Move a block, keeping it inside the frame.
 *
 * Clamped against the block's own size rather than to 0..100, so dragging a
 * wide block to the right edge stops when its RIGHT side reaches the edge —
 * not when its left does, which would let most of it hang outside.
 */
export function moveCanvasBlock(
  blocks: CanvasBlock[],
  id: string,
  x: number,
  y: number,
): CanvasBlock[] {
  return blocks.map((block) => {
    if (block.id !== id) return block;
    return {
      ...block,
      x: round(clamp(x, 0, Math.max(0, 100 - block.width))),
      y: round(clamp(y, 0, Math.max(0, 100 - block.height))),
    };
  });
}

/**
 * Resize a block from its top-left anchor.
 *
 * Capped so the block cannot extend past the frame, which keeps the invariant
 * that every block is fully inside it — the property that makes percentage
 * placement safe to render at any width.
 */
export function resizeCanvasBlock(
  blocks: CanvasBlock[],
  id: string,
  width: number,
  height: number,
): CanvasBlock[] {
  return blocks.map((block) => {
    if (block.id !== id) return block;
    return {
      ...block,
      width: round(clamp(width, MIN_BLOCK_SIZE, 100 - block.x)),
      height: round(clamp(height, MIN_BLOCK_SIZE, 100 - block.y)),
    };
  });
}

export function updateCanvasBlock(
  blocks: CanvasBlock[],
  id: string,
  patch: Partial<CanvasBlock>,
): CanvasBlock[] {
  return blocks.map((block) => (block.id === id ? { ...block, ...patch, id: block.id } : block));
}

export function removeCanvasBlock(blocks: CanvasBlock[], id: string): CanvasBlock[] {
  return blocks.filter((block) => block.id !== id);
}

/**
 * A pointer position as a percentage of the frame.
 *
 * Takes the frame's ON-SCREEN rect, which already includes the builder's zoom
 * scale — so this needs no zoom argument and cannot get one wrong.
 */
export function pointToPercent(
  clientX: number,
  clientY: number,
  frame: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (!(frame.width > 0) || !(frame.height > 0)) return { x: 0, y: 0 };
  return {
    x: ((clientX - frame.left) / frame.width) * 100,
    y: ((clientY - frame.top) / frame.height) * 100,
  };
}

/** Every block sits fully inside the frame. Used as a guard after any edit. */
export function blocksAreInBounds(blocks: CanvasBlock[]): boolean {
  return blocks.every((block) => (
    block.x >= 0
    && block.y >= 0
    && block.x + block.width <= 100.05
    && block.y + block.height <= 100.05
  ));
}
