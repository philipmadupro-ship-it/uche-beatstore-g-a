import { describe, it, expect } from 'vitest';
import {
  CONTROL_CLASSES,
  CONTROL_SPECS,
  TAP_TARGET,
  coarseTapExtension,
  minGapForTap,
  tapExtension,
  type ControlSize,
} from './control-size';

const SIZES = Object.keys(CONTROL_SPECS) as ControlSize[];

describe('control size scale', () => {
  it('is ordered: icon <= sm... md is the tallest labelled control', () => {
    expect(CONTROL_SPECS.sm.height).toBeLessThan(CONTROL_SPECS.md.height);
    expect(CONTROL_SPECS.md.height).toBe(36);
    expect(CONTROL_SPECS.sm.height).toBe(28);
    expect(CONTROL_SPECS.icon.height).toBe(32);
  });

  it('only uses label sizes that are steps on the type scale', () => {
    for (const s of SIZES) expect([10, 11]).toContain(CONTROL_SPECS[s].fontPx);
  });

  it('never lets the touch visual shrink below the mouse visual', () => {
    for (const s of SIZES) expect(CONTROL_SPECS[s].coarseHeight).toBeGreaterThanOrEqual(CONTROL_SPECS[s].height);
  });

  it('reaches the tap target on touch for every size', () => {
    for (const s of SIZES) {
      const visual = CONTROL_SPECS[s].coarseHeight;
      expect(visual + 2 * coarseTapExtension(s)).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  it('computes the padding and the neighbour gap that keeps hit areas apart', () => {
    expect(tapExtension(28)).toBe(8);
    expect(tapExtension(36)).toBe(4);
    expect(tapExtension(44)).toBe(0);
    expect(tapExtension(60)).toBe(0);
    expect(minGapForTap(6)).toBe(12);
  });

  it('writes the same numbers into the Tailwind classes as the spec', () => {
    // md: fixed height
    expect(CONTROL_CLASSES.md).toContain('h-9');
    expect(CONTROL_CLASSES.md).toContain('text-[11px]');
    expect(CONTROL_CLASSES.md).toContain(`[--tap-y:${coarseTapExtension('md')}px]`);
    // sm: 28px, 32px on touch
    expect(CONTROL_CLASSES.sm).toContain('h-7');
    expect(CONTROL_CLASSES.sm).toContain('pointer-coarse:h-8');
    expect(CONTROL_CLASSES.sm).toContain('text-[10px]');
    expect(CONTROL_CLASSES.sm).toContain(`[--tap-y:${coarseTapExtension('sm')}px]`);
    // icon: 32px, 40px on touch
    expect(CONTROL_CLASSES.icon).toContain('size-8');
    expect(CONTROL_CLASSES.icon).toContain('pointer-coarse:size-10');
    expect(CONTROL_CLASSES.icon).toContain(`[--tap-y:${coarseTapExtension('icon')}px]`);
  });

  it('makes every size use the hit-area class', () => {
    for (const s of SIZES) expect(CONTROL_CLASSES[s]).toContain('ctl-tap');
  });
});
