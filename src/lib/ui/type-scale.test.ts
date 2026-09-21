import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards the small end of the type scale.
 *
 * `docs/design-direction.md` principle 2 asks for fewer sizes per screen —
 * target ≤ 4 text styles visible at once — and names the worst offenders:
 * `store/[id]` and `sales`, at 8 and 9 distinct sizes each. App-wide there
 * were 28. Most of that mass sits between 7px and 13px, where a one-pixel
 * step is invisible in isolation and obvious in aggregate: two labels a
 * pixel apart in the same panel read as a rendering bug rather than a
 * hierarchy.
 *
 * The doc calls collapsing **12px into 11px** the single highest-leverage
 * change, which is what this enforces. 11px was already the dominant body
 * size (626 uses against 295), so the merge moves the minority onto the
 * majority rather than inventing a value.
 *
 * SCOPE: this guards the crowded 7–13px band only. Headings above it are
 * still scattered (14, 15, 16, 17, 18, 20, 22, 24, 28…) and collapsing those
 * is a visual judgement per surface, not a rule — widen this when that pass
 * happens rather than banning sizes nobody has agreed a replacement for.
 */

function sourceFiles(): string[] {
  return execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter(Boolean);
}

/**
 * The steps the small end is allowed to use.
 *
 * - `8px` — the densest metadata chips.
 * - `9px` / `10px` — mono uppercase micro-labels; 10px is the canonical one
 *   named in CLAUDE.md.
 * - `11px` — body and secondary text, the dominant size in the app.
 * - `13px` — the emphasis step above body.
 *
 * 7px and 12px are deliberately absent: 7px is below the smallest real step
 * and 12px is a pixel off body, which is the exact kind of near-duplicate
 * principle 2 is about.
 */
const ALLOWED_SMALL = new Set([8, 9, 10, 11, 13]);
const SMALL_BAND = { min: 7, max: 13 };

/**
 * `text-[0px] sm:text-[10px]` in `LyricsStudio` collapses a button label to
 * an icon on narrow screens. It is a responsive visibility trick, not a type
 * size — 0px is not a step on any scale — so it is exempt rather than being
 * rounded up into one.
 */
const EXEMPT_SIZES = new Set([0]);

const TEXT_SIZE = /text-\[(\d+)px\]/g;

describe('type scale (7–13px band)', () => {
  it('uses only the agreed small steps', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      const seen = new Map<number, number>();
      for (const m of src.matchAll(TEXT_SIZE)) {
        const px = Number(m[1]);
        if (EXEMPT_SIZES.has(px)) continue;
        if (px < SMALL_BAND.min || px > SMALL_BAND.max) continue;
        if (ALLOWED_SMALL.has(px)) continue;
        seen.set(px, (seen.get(px) ?? 0) + 1);
      }
      for (const [px, n] of seen) violations.push(`${file}: text-[${px}px] x${n}`);
    }
    expect(
      violations,
      `Found ${violations.length} file(s) using a small text size outside the scale. Allowed: 8, 9, 10, 11 (body), 13. Use 11px instead of 12px — it is already the dominant body size — and 8px instead of 7px. See docs/design-direction.md principle 2:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
