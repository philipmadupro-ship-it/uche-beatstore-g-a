import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A vendor-prefixed declaration must come BEFORE its standard property.
 *
 * `globals.css` wrote `backdrop-filter` then `-webkit-backdrop-filter`. The
 * production minifier treats the later declaration as the one that wins and
 * drops the earlier standard property, so the built CSS carried only the
 * prefixed form. Chrome does not support `-webkit-backdrop-filter`
 * (`CSS.supports` returns false), so in production Chrome every hand-written
 * glass surface — the toasts, the overlay menus, the glass play button — had
 * no blur at all. Development CSS is not minified, so it looked right locally
 * and in every dev-server screenshot.
 *
 * Tailwind's own `backdrop-blur-*` utilities emit prefixed-first and survive,
 * which is the order this enforces for hand-written rules.
 */
describe('globals.css vendor prefix order', () => {
  it('declares every -webkit- property before its standard counterpart in the same rule', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
      // Comments may legitimately mention either property.
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const violations: string[] = [];
    // Innermost declaration blocks only; nested @media bodies are covered
    // because their own rule blocks match too.
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1].trim().split('\n').pop()!.trim();
      const decls = block[2].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);
      decls.forEach((prop, i) => {
        if (!prop.startsWith('-webkit-')) return;
        const standard = prop.slice('-webkit-'.length);
        const standardAt = decls.indexOf(standard);
        if (standardAt !== -1 && standardAt < i) violations.push(`${selector}: ${standard} before ${prop}`);
      });
    }

    expect(
      violations,
      `Standard property declared before its -webkit- form. The minifier drops the standard one, and Chrome ignores the prefix:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
