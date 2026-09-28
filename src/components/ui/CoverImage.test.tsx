// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CoverImage } from './CoverImage';

/**
 * Covers next/image can't optimise (a pasted URL on another host, blob: and
 * data: URLs) render as a plain <img>. That <img> must fill its box the way
 * next/image's `fill` does, or the caller's `object-cover` has nothing to crop
 * against: it rendered at the picture's natural aspect, so a portrait cover
 * showed its top-left corner and a landscape one left the tile half empty.
 *
 * jsdom has no layout, so the geometry itself is asserted in the browser by
 * e2e/library-hero-cover.spec.ts. This pins the classes that produce it.
 */
describe('CoverImage plain-img fallback', () => {
  it.each([
    ['data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['blob: URL', 'blob:http://localhost/1234'],
    ['unlisted host', 'https://example.com/cover.jpg'],
  ])('fills its box for a %s', (_label, src) => {
    const { container } = render(<CoverImage src={src} className="object-cover" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(src);
    const classes = img.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['block', 'h-full', 'w-full', 'object-cover']));
  });

  it('keeps the caller classes after the fill defaults', () => {
    const { container } = render(
      <CoverImage src="data:image/png;base64,iVBORw0KGgo=" className="object-cover scale-110" />,
    );
    expect(container.querySelector('img')!.className).toBe('block h-full w-full object-cover scale-110');
  });
});
