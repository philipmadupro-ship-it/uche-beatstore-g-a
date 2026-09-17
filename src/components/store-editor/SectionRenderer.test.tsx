// @vitest-environment jsdom

/**
 * Free-form canvas blocks, exercised through the real component.
 *
 * The maths lives in `lib/store-editor/canvas-blocks.ts` and is unit-tested
 * there. What this file covers is the wiring the maths cannot see: that the
 * drag reports percentages of the FRAME, that a drag which leaves the frame
 * still ends, and — most importantly — that none of the editing affordances
 * exist at all when `editBlocks` is absent, which is how the live storefront
 * renders this identical component.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionRenderer, type StorefrontData } from './SectionRenderer';
import {
  createSection, defaultStoreTheme, type StoreSection,
} from '@/lib/store-editor/layout';
import { createCanvasBlock } from '@/lib/store-editor/canvas-blocks';

const data: StorefrontData = {
  creator: null, tracks: [], playlists: [], projects: [], picks: [],
};

function canvasSection(): { section: StoreSection; blockId: string } {
  const block = { ...createCanvasBlock('shape'), x: 10, y: 10, width: 20, height: 20 };
  const section = createSection('canvas', 'Panel');
  return {
    section: { ...section, content: { blocks: [block] } },
    blockId: block.id,
  };
}

/**
 * jsdom gives every element a zero-sized rect, and `pointToPercent` correctly
 * refuses to divide by zero — so the frame needs a real size for a drag to
 * mean anything. Stubbed on the prototype because the frame element is found
 * through `parentElement` inside the handler, not held by the test.
 */
function stubFrameSize(rect: { left: number; top: number; width: number; height: number }) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stub(this: Element) {
    return {
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => { Element.prototype.getBoundingClientRect = original; };
}

function pointerDown(el: Element, clientX: number, clientY: number) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX, clientY, button: 0 }));
}

describe('canvas blocks in the builder', () => {
  it('renders each block', () => {
    const { section } = canvasSection();
    render(
      <SectionRenderer
        section={section}
        breakpoint="desktop"
        theme={defaultStoreTheme}
        data={data}
        editBlocks={{ selectedId: null, onSelect: vi.fn(), onMove: vi.fn() }}
      />,
    );
    expect(screen.getByLabelText('shape block')).toBeTruthy();
  });

  it('selects a block on press', () => {
    const { section, blockId } = canvasSection();
    const onSelect = vi.fn();
    render(
      <SectionRenderer
        section={section}
        breakpoint="desktop"
        theme={defaultStoreTheme}
        data={data}
        editBlocks={{ selectedId: null, onSelect, onMove: vi.fn() }}
      />,
    );
    pointerDown(screen.getByLabelText('shape block'), 0, 0);
    expect(onSelect).toHaveBeenCalledWith(blockId);
  });

  it('reports the move as a percentage of the frame, preserving the grab offset', () => {
    // The block sits at 10%,10% in a 1000x500 frame → 100px,50px. Grabbing it
    // at 150px,100px is a 5%,10% offset into the block. Dragging to 550px,300px
    // must therefore report 50%,50% — not 55%,60%, which is what dropping the
    // grab offset would give and would make the block jump under the cursor.
    const restore = stubFrameSize({ left: 0, top: 0, width: 1000, height: 500 });
    try {
      const { section, blockId } = canvasSection();
      const onMove = vi.fn();
      render(
        <SectionRenderer
          section={section}
          breakpoint="desktop"
          theme={defaultStoreTheme}
          data={data}
          editBlocks={{ selectedId: blockId, onSelect: vi.fn(), onMove }}
        />,
      );
      pointerDown(screen.getByLabelText('shape block'), 150, 100);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 550, clientY: 300 }));

      expect(onMove).toHaveBeenCalled();
      const [id, x, y, commit] = onMove.mock.calls.at(-1)!;
      expect(id).toBe(blockId);
      expect(x).toBeCloseTo(50, 5);
      expect(y).toBeCloseTo(50, 5);
      // Intermediate moves must not commit, or one drag fills the undo stack.
      expect(commit).toBe(false);
    } finally {
      restore();
    }
  });

  it('commits exactly once, on release', () => {
    const restore = stubFrameSize({ left: 0, top: 0, width: 1000, height: 500 });
    try {
      const { section, blockId } = canvasSection();
      const onMove = vi.fn();
      render(
        <SectionRenderer
          section={section}
          breakpoint="desktop"
          theme={defaultStoreTheme}
          data={data}
          editBlocks={{ selectedId: blockId, onSelect: vi.fn(), onMove }}
        />,
      );
      pointerDown(screen.getByLabelText('shape block'), 150, 100);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 200 }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 450, clientY: 250 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 550, clientY: 300 }));

      const commits = onMove.mock.calls.filter((call) => call[3] === true);
      expect(commits).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('stops listening after release, so the block does not follow the cursor', () => {
    const restore = stubFrameSize({ left: 0, top: 0, width: 1000, height: 500 });
    try {
      const { section, blockId } = canvasSection();
      const onMove = vi.fn();
      render(
        <SectionRenderer
          section={section}
          breakpoint="desktop"
          theme={defaultStoreTheme}
          data={data}
          editBlocks={{ selectedId: blockId, onSelect: vi.fn(), onMove }}
        />,
      );
      pointerDown(screen.getByLabelText('shape block'), 150, 100);
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 200 }));
      const afterRelease = onMove.mock.calls.length;
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 400 }));
      expect(onMove.mock.calls.length).toBe(afterRelease);
    } finally {
      restore();
    }
  });
});

describe('the same component on the live storefront', () => {
  it('renders no editing affordances when editBlocks is absent', () => {
    // The capability is ABSENT rather than switched off: a buyer's storefront
    // renders this identical component, and nothing draggable, no pointer
    // handler and no selection ring can reach them.
    const { section } = canvasSection();
    const { container } = render(
      <SectionRenderer
        section={section}
        breakpoint="desktop"
        theme={defaultStoreTheme}
        data={data}
      />,
    );
    expect(screen.queryByLabelText('shape block')).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.innerHTML).not.toContain('cursor-move');
  });

  it('still draws the blocks themselves', () => {
    const { section } = canvasSection();
    const { container } = render(
      <SectionRenderer
        section={section}
        breakpoint="desktop"
        theme={defaultStoreTheme}
        data={data}
      />,
    );
    // Positioned by percentage, so it reflows at any device width.
    expect(container.innerHTML).toContain('left: 10%');
    expect(container.innerHTML).toContain('width: 20%');
  });
});
