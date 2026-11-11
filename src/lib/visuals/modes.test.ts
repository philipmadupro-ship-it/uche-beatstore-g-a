import { describe, expect, it } from 'vitest';
import { DEFAULT_VISUAL_MODE, parseVisualMode, stepMode } from './modes';

describe('modes', () => {
  it('parses unknown input to the default', () => {
    expect(parseVisualMode('orbit')).toBe('orbit');
    expect(parseVisualMode('nope')).toBe(DEFAULT_VISUAL_MODE);
    expect(parseVisualMode(null)).toBe(DEFAULT_VISUAL_MODE);
  });
  it('steps and wraps', () => {
    expect(stepMode('terrain', -1)).toBe('meters');
    expect(stepMode('meters', 1)).toBe('terrain');
  });
});
