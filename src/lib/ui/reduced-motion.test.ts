import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards against ambient decorative motion that ignores `prefers-reduced-motion`.
 *
 * Tailwind's built-in `animate-pulse` / `animate-bounce` utilities have no
 * global reduced-motion override in `src/app/globals.css` (unlike our custom
 * `.animate-vinyl` etc., which do). Every use of these two utilities on a
 * persistent, ambient status indicator — a "now playing" dot, a recording
 * indicator, an equalizer bar — must therefore be gated per-component via
 * `useReducedMotion()`, conditionally including the class only when motion
 * isn't reduced. This exact bug (an ungated `animate-pulse`/`animate-bounce`
 * shipped on a new status indicator) recurred multiple times in one session,
 * which is why it's now a source guard rather than a review checklist item.
 *
 * `animate-spin` is deliberately excluded — it's used exclusively on `Loader2`
 * functional spinners, which (like the allowlisted skeletons below) are
 * transient status feedback, not the ambient decoration this guards against.
 */

/**
 * Files with a documented, allowlisted exemption: brief, transient loading
 * feedback (skeleton placeholders, a during-upload processing overlay, an
 * auth-verification spinner) rather than ambient decoration tied to a
 * persistent UI state. These disappear once the underlying operation
 * finishes, the same as a spinner would.
 */
const ALLOWLIST = new Set([
  'src/app/embed/[id]/page.tsx',
  'src/app/(auth)/invite/[token]/page.tsx',
  'src/components/tracks/drawer/DrawerStemOverlay.tsx',
  'src/components/store/StoreSidebar.tsx',
  'src/components/player/WavePlayer.tsx',
]);

function sourceFiles(): string[] {
  const out = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.endsWith('src/lib/ui/reduced-motion.test.ts'))
    .filter((f) => !ALLOWLIST.has(f));
}

const ANIMATION_CLASS = /animate-(?:pulse|bounce)/;

function findViolations(): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles()) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted between ls-files and read
    }
    contents.split('\n').forEach((line, i) => {
      if (ANIMATION_CLASS.test(line) && !line.includes('reducedMotion')) {
        hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return hits;
}

describe('Reduced-motion gating', () => {
  it('gates every animate-pulse/animate-bounce on reducedMotion (or is allowlisted as transient loading feedback)', () => {
    const violations = findViolations();
    expect(
      violations,
      `Found ${violations.length} ungated animate-pulse/animate-bounce class(es). ` +
        `Either gate them with useReducedMotion() (see src/components/store/BandcampRemixCard.tsx for the pattern) ` +
        `or add the file to ALLOWLIST in this test if it's genuinely transient loading feedback:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
