import { describe, expect, it } from 'vitest';
import {
  MIN_BLOCK_SIZE, blocksAreInBounds, canvasBlockKinds, createCanvasBlock,
  moveCanvasBlock, pointToPercent, removeCanvasBlock, resizeCanvasBlock, updateCanvasBlock,
} from './canvas-blocks';

describe('createCanvasBlock', () => {
  it.each(canvasBlockKinds)('creates a %s inside the frame', (kind) => {
    const block = createCanvasBlock(kind);
    expect(block.kind).toBe(kind);
    expect(blocksAreInBounds([block])).toBe(true);
  });

  it('gives every block a unique id', () => {
    const ids = [
      createCanvasBlock('text').id,
      createCanvasBlock('text').id,
      createCanvasBlock('shape').id,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('gives a text block something to see and edit', () => {
    const block = createCanvasBlock('text');
    expect(block.text).toBeTruthy();
    expect(block.fontSize).toBeGreaterThan(0);
  });
});

describe('moveCanvasBlock', () => {
  const blocks = [createCanvasBlock('text')];
  const id = blocks[0].id;

  it('moves the named block only', () => {
    const two = [...blocks, createCanvasBlock('shape')];
    const moved = moveCanvasBlock(two, id, 50, 60);
    expect(moved[0]).toMatchObject({ x: 50, y: 60 });
    expect(moved[1]).toEqual(two[1]);
  });

  it('clamps against the block’s own size, not just 0..100', () => {
    // The failure this prevents: clamping x to 100 lets a 40%-wide block sit
    // at 100 with 40% of itself outside the frame.
    const moved = moveCanvasBlock(blocks, id, 200, 200);
    const block = moved[0];
    expect(block.x + block.width).toBeLessThanOrEqual(100);
    expect(block.y + block.height).toBeLessThanOrEqual(100);
  });

  it('clamps a negative position to the top-left', () => {
    expect(moveCanvasBlock(blocks, id, -50, -50)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('rounds to a tenth of a percent', () => {
    const moved = moveCanvasBlock(blocks, id, 43.8271604938, 12.3456789);
    expect(moved[0].x).toBe(43.8);
    expect(moved[0].y).toBe(12.3);
  });

  it('keeps everything in bounds however far it is dragged', () => {
    for (const [x, y] of [[-999, -999], [0, 0], [50, 50], [999, 999]]) {
      expect(blocksAreInBounds(moveCanvasBlock(blocks, id, x, y))).toBe(true);
    }
  });

  it('is a no-op for an unknown id', () => {
    expect(moveCanvasBlock(blocks, 'nope', 50, 50)[0]).toEqual(blocks[0]);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(blocks);
    moveCanvasBlock(blocks, id, 70, 70);
    expect(JSON.stringify(blocks)).toBe(before);
  });

  it('handles a block wider than the frame without going negative', () => {
    const wide = [{ ...createCanvasBlock('shape'), width: 140, x: 0 }];
    const moved = moveCanvasBlock(wide, wide[0].id, 50, 10);
    expect(moved[0].x).toBe(0);
  });
});

describe('resizeCanvasBlock', () => {
  const blocks = [createCanvasBlock('shape')];
  const id = blocks[0].id;

  it('resizes the named block', () => {
    expect(resizeCanvasBlock(blocks, id, 60, 30)[0]).toMatchObject({ width: 60, height: 30 });
  });

  it('never lets a block shrink below the grabbable minimum', () => {
    const small = resizeCanvasBlock(blocks, id, 0, 0)[0];
    expect(small.width).toBe(MIN_BLOCK_SIZE);
    expect(small.height).toBe(MIN_BLOCK_SIZE);
  });

  it('caps growth at the frame edge, from the block’s own position', () => {
    const placed = moveCanvasBlock(blocks, id, 70, 70);
    const grown = resizeCanvasBlock(placed, id, 999, 999)[0];
    expect(grown.x + grown.width).toBeLessThanOrEqual(100);
    expect(grown.y + grown.height).toBeLessThanOrEqual(100);
  });

  it('keeps everything in bounds at every size', () => {
    for (const size of [0, 5, 50, 100, 999]) {
      expect(blocksAreInBounds(resizeCanvasBlock(blocks, id, size, size))).toBe(true);
    }
  });
});

describe('updateCanvasBlock', () => {
  const blocks = [createCanvasBlock('text')];
  const id = blocks[0].id;

  it('patches content fields', () => {
    expect(updateCanvasBlock(blocks, id, { text: 'HELLO' })[0].text).toBe('HELLO');
  });

  it('refuses to let a patch change the id', () => {
    // An id rewritten mid-edit orphans the selection and any in-flight drag.
    expect(updateCanvasBlock(blocks, id, { id: 'hacked' } as never)[0].id).toBe(id);
  });

  it('leaves other blocks alone', () => {
    const two = [...blocks, createCanvasBlock('shape')];
    expect(updateCanvasBlock(two, id, { text: 'X' })[1]).toEqual(two[1]);
  });
});

describe('removeCanvasBlock', () => {
  it('removes only the named block', () => {
    const two = [createCanvasBlock('text'), createCanvasBlock('shape')];
    const left = removeCanvasBlock(two, two[0].id);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(two[1].id);
  });

  it('is a no-op for an unknown id', () => {
    const two = [createCanvasBlock('text')];
    expect(removeCanvasBlock(two, 'nope')).toHaveLength(1);
  });
});

describe('pointToPercent', () => {
  const frame = { left: 100, top: 50, width: 400, height: 200 };

  it('maps a point to a percentage of the frame', () => {
    expect(pointToPercent(300, 150, frame)).toEqual({ x: 50, y: 50 });
    expect(pointToPercent(100, 50, frame)).toEqual({ x: 0, y: 0 });
    expect(pointToPercent(500, 250, frame)).toEqual({ x: 100, y: 100 });
  });

  it('needs no zoom argument, because a scaled rect is already in screen pixels', () => {
    // The same document point at half scale sits at half the screen distance
    // AND the frame is half as wide, so the ratio is unchanged. This is why
    // percentage placement cannot get the builder's zoom wrong.
    const zoomed = { left: 100, top: 50, width: 200, height: 100 };
    expect(pointToPercent(200, 100, zoomed)).toEqual({ x: 50, y: 50 });
  });

  it('reports positions outside the frame, leaving clamping to the caller', () => {
    expect(pointToPercent(0, 0, frame).x).toBeLessThan(0);
  });

  it('returns the origin rather than dividing by zero on a collapsed frame', () => {
    expect(pointToPercent(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('blocksAreInBounds', () => {
  it('is true for an empty list', () => {
    expect(blocksAreInBounds([])).toBe(true);
  });

  it('catches a block hanging off the edge', () => {
    expect(blocksAreInBounds([{ ...createCanvasBlock('shape'), x: 90, width: 40 }])).toBe(false);
    expect(blocksAreInBounds([{ ...createCanvasBlock('shape'), x: -5 }])).toBe(false);
  });
});
