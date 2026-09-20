import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards the radii vocabulary in `src/components/ui/` — the hand-rolled
 * primitives everything else is built from.
 *
 * `docs/design-direction.md` allows exactly three radii: **8px** for controls,
 * **12px** for cards, **20px** for modals and heroes. Nothing else. The doc is
 * equally explicit about the order of work: fix the primitives *before* the
 * pages, "or the drift comes back". A `Card` that is 16px is not one wrong
 * component — it is the wrong radius arriving on every page that adopts it,
 * which is why this guard covers the primitives and not (yet) the pages.
 *
 * Deliberately scoped to `src/components/ui/`. The pages still hold plenty of
 * off-vocabulary radii; widening this test now would turn it into a permanent
 * failure that gets skipped, which is worse than no test. Widen it as the
 * rollout reaches each surface.
 *
 * In Tailwind's default scale: `rounded-lg` is 8px, `rounded-xl` is 12px, and
 * 20px has no scale name, so it is spelled `rounded-[20px]`. The tempting
 * near-misses are `rounded-md` (6px), `rounded-2xl` (16px) and `rounded-3xl`
 * (24px) — each one degree off a real token and invisible in review.
 */

function primitiveFiles(): string[] {
  return execSync('git ls-files "src/components/ui/*.tsx"', { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter(Boolean);
}

/**
 * Radii that are allowed but are not one of the three surface tokens.
 *
 * - `rounded-full` — pills and circles. A pill's radius is its height, not a
 *   step on the surface scale, so the vocabulary does not apply to it.
 * - `rounded-t-full` — the gloss highlight inside the two glass buttons. It is
 *   a painted gradient sitting on top of a circular control, not a surface.
 * - `rounded-inherit` / `rounded-[inherit]` — an overlay taking its parent's
 *   shape, which is how it stays correct when the parent's radius changes.
 * - `rounded-[3px]` — the 15px colour swatch in `ColorPicker`. At that size an
 *   8px radius is most of the square and the swatch reads as a circle, which
 *   is the one shape a colour swatch must not be (it is not a status dot).
 */
const ALLOWED_EXCEPTIONS = new Set([
  'rounded-full',
  'rounded-t-full',
  'rounded-inherit',
  'rounded-[inherit]',
  'rounded-[3px]',
]);

/** The three real tokens, in every directional form (`rounded-t-xl`, …). */
const TOKEN_SUFFIX = /^rounded(?:-(?:t|r|b|l|tl|tr|bl|br|s|e|ss|se|es|ee))?-(?:lg|xl|\[20px\])$/;

/** Any `rounded…` utility, including responsive and state prefixes. */
const RADIUS_CLASS = /(?:^|[\s"'`])((?:(?:sm|md|lg|xl|2xl|hover|focus|active|group-hover|data-\[[^\]]+\]):)*rounded(?:-[a-z]+)*(?:-(?:\[[^\]]+\]|none|full|inherit|sm|md|lg|xl|2xl|3xl))?)(?=[\s"'`]|$)/g;

/**
 * Class strings only. The word "rounded" appears in these files' prose too —
 * `ActionMenu` describes an "inset, rounded highlight" and `ListRow` explains
 * drawing a focus ring on "a rounded container" — and an earlier draft of this
 * test reported both comments as violations.
 */
function radiiIn(src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(/[`'"]([^`'"\n]*\brounded[^`'"\n]*)[`'"]/g)) {
    for (const r of m[1].matchAll(RADIUS_CLASS)) found.push(r[1]);
  }
  return found;
}

describe('src/components/ui radii vocabulary', () => {
  it('uses only 8px, 12px and 20px (plus documented exceptions)', () => {
    const violations: string[] = [];
    for (const file of primitiveFiles()) {
      if (file.endsWith('.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      for (const cls of radiiIn(src)) {
        const bare = cls.replace(/^(?:[\w-]+(?:\[[^\]]*\])?:)+/, '');
        if (ALLOWED_EXCEPTIONS.has(bare) || TOKEN_SUFFIX.test(bare)) continue;
        violations.push(`${file}: ${cls}`);
      }
    }
    expect(
      violations,
      `Found ${violations.length} off-vocabulary radius/radii in the UI primitives. Allowed: rounded-lg (8px controls), rounded-xl (12px cards), rounded-[20px] (modals/heroes), plus rounded-full. See docs/design-direction.md:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
