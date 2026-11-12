import { describe, expect, it } from 'vitest';
import { canCapture, classifySource, crossOriginFor } from './analysable';

const PAGE = 'https://store.example';
const known = new Map<string, boolean>([['https://cdn.ok', true], ['https://cdn.bad', false]]);

describe('classifySource', () => {
  it('same-origin, relative and blob sources are capturable with no crossOrigin', () => {
    for (const src of ['/api/store/preview/1', 'https://store.example/a.mp3', 'blob:https://store.example/x']) {
      const c = classifySource(src, PAGE, known);
      expect(c).toBe('same-origin');
      expect(canCapture(c)).toBe(true);
      expect(crossOriginFor(c)).toBeNull();
    }
  });
  it('cross-origin needs a proven CORS origin and crossOrigin=anonymous', () => {
    const c = classifySource('https://cdn.ok/p.mp3', PAGE, known);
    expect(c).toBe('cors-ok');
    expect(canCapture(c)).toBe(true);
    expect(crossOriginFor(c)).toBe('anonymous');
  });
  it('unknown or bad cross-origin is never captured (it would play silent)', () => {
    for (const src of ['https://other/p.mp3', 'https://cdn.bad/p.mp3']) {
      const c = classifySource(src, PAGE, known);
      expect(canCapture(c)).toBe(false);
      expect(crossOriginFor(c)).toBeNull();
    }
  });
});
