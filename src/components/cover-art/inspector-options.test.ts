import { describe, expect, it } from 'vitest';
import { artworkBlendModes } from '@/lib/cover/effects';
import { blendModeOptions } from './InspectorPanel';

describe('blend mode menu', () => {
  it('offers every mode the renderers support', () => {
    // Widening the engine without widening the menu makes a blend mode
    // unreachable, which reads as "the app does not support it" rather than
    // "someone forgot a line".
    expect([...blendModeOptions.map((option) => option.value)].sort())
      .toEqual([...artworkBlendModes].sort());
  });

  it('offers nothing the renderers do not support', () => {
    for (const option of blendModeOptions) {
      expect(artworkBlendModes, `${option.value} is not a supported blend mode`)
        .toContain(option.value);
    }
  });

  it('has no duplicate entries', () => {
    const values = blendModeOptions.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('gives every mode a distinct human label', () => {
    // `color-dodge` and `color-burn` truncating to the same string is exactly
    // what made the previous segmented control unusable.
    const labels = blendModeOptions.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('leads with normal, the neutral default', () => {
    expect(blendModeOptions[0].value).toBe('normal');
  });

  it('groups the list so a sixteen-item menu stays scannable', () => {
    const separators = blendModeOptions.filter((option) => option.separator);
    expect(separators.length).toBeGreaterThanOrEqual(4);
  });
});
