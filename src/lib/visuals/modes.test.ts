import { describe, expect, it } from 'vitest';
import { DEFAULT_VISUAL_MODE, parseVisualMode, stepMode } from './modes';

describe('modes', () => {
  it('parses unknown input to the default', () => {
    expect(parseVisualMode('terrain')).toBe('terrain');
    expect(parseVisualMode('meters')).toBe(DEFAULT_VISUAL_MODE); // retired mode
    expect(DEFAULT_VISUAL_MODE).toBe('orbit');
    expect(parseVisualMode('nope')).toBe(DEFAULT_VISUAL_MODE);
    expect(parseVisualMode(null)).toBe(DEFAULT_VISUAL_MODE);
  });
  it('steps and wraps', () => {
    expect(stepMode('orbit', -1)).toBe('curve');
    expect(stepMode('curve', 1)).toBe('orbit');
  });
});
