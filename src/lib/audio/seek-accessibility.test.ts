import { describe, expect, it } from 'vitest';
import { keyboardSeekFraction } from './seek-accessibility';

describe('keyboard seek accessibility', () => {
  it('moves by five seconds with arrow keys', () => {
    expect(keyboardSeekFraction('ArrowRight', 0.5, 100)).toBe(0.55);
    expect(keyboardSeekFraction('ArrowLeft', 0.5, 100)).toBe(0.45);
  });

  it('moves by thirty seconds with page keys', () => {
    expect(keyboardSeekFraction('PageUp', 0.2, 120)).toBe(0.45);
    expect(keyboardSeekFraction('PageDown', 0.45, 120)).toBe(0.2);
  });

  it('jumps to boundaries and clamps values', () => {
    expect(keyboardSeekFraction('Home', 0.5, 0)).toBe(0);
    expect(keyboardSeekFraction('End', 0.5, 0)).toBe(1);
    expect(keyboardSeekFraction('ArrowRight', 0.98, 100)).toBe(1);
    expect(keyboardSeekFraction('ArrowLeft', 0.02, 100)).toBe(0);
  });

  it('ignores unsupported keys and unknown duration', () => {
    expect(keyboardSeekFraction('Enter', 0.5, 100)).toBeNull();
    expect(keyboardSeekFraction('ArrowRight', 0.5, 0)).toBeNull();
    expect(keyboardSeekFraction('ArrowRight', 0.5, null)).toBeNull();
  });
});
