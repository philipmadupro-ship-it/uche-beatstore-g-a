import { describe, expect, it } from 'vitest';
import { safeColor, safeImageUrl, sectionFrame } from './section-frame';

describe('sectionFrame', () => {
  it('paints nothing by default, so un-styled sections render exactly as before', () => {
    expect(sectionFrame({})).toEqual({ style: {}, overlay: 0, active: false });
  });
  it('builds background, text colour, height and radius', () => {
    const f = sectionFrame({ background: '#101010', textColor: '#fff', minHeight: 420, radius: 12 });
    expect(f.style).toMatchObject({ backgroundColor: '#101010', color: '#fff', minHeight: '420px', borderRadius: '12px', position: 'relative' });
    expect(f.active).toBe(true);
  });
  it('applies an overlay only when there is an image to darken', () => {
    expect(sectionFrame({ overlay: 50 }).overlay).toBe(0);
    expect(sectionFrame({ backgroundImage: 'https://cdn.x/a.jpg', overlay: 50 }).overlay).toBe(0.5);
    expect(sectionFrame({ backgroundImage: 'https://cdn.x/a.jpg', overlay: 500 }).overlay).toBe(0.8);
  });
  it('clamps silly numbers', () => {
    expect(sectionFrame({ minHeight: -5, radius: 999 }).style).toMatchObject({ borderRadius: '64px' });
  });
});

describe('sanitisers', () => {
  it('accepts hex colours only', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('red; background:url(x)')).toBeNull();
  });
  it('accepts https and same-origin image URLs only', () => {
    expect(safeImageUrl('https://cdn.x/a.jpg')).toBe('https://cdn.x/a.jpg');
    expect(safeImageUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(safeImageUrl('http://x/a.jpg')).toBeNull();
    expect(safeImageUrl('//evil/a.jpg')).toBeNull();
    expect(safeImageUrl('https://x/a.jpg")')).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
  });
});
