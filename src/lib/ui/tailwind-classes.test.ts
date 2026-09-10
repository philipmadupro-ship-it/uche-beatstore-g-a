import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards against malformed Tailwind opacity modifiers.
 *
 * These are not style nits — a class like `ring-white/30/40` or `border-white/`
 * matches no Tailwind utility and compiles to **nothing**, so the intended
 * border/ring/background silently does not render. A scripted colour migration
 * (commit 3fe5698) introduced 167 of them across 67 files, ~10 of which were
 * `focus-visible:` rings. The result was store cards, the checkout inputs and
 * the shared Dropdown having *no visible keyboard focus indicator at all* —
 * a direct violation of the hard constraints in docs/design-direction.md.
 *
 * They are invisible to `tsc`, to ESLint, and to a passing build, which is why
 * they survived several review passes. This test is the only thing that catches
 * them, so it deliberately scans source text rather than rendered output.
 */

/**
 * Every tracked source file we style in, minus this one.
 *
 * Excluding self is load-bearing, not tidiness: the patterns below are spelled
 * out verbatim in this file's comments and test names, so a scan that included
 * it would always report three false positives. That is not hypothetical — the
 * first version of this test omitted the filter and passed anyway, because
 * `git ls-files` lists only *tracked* files and the test was still untracked
 * when it ran. Committing it was what turned it red.
 */
function sourceFiles(): string[] {
  const out = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts" "src/**/*.css"', {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.endsWith('src/lib/ui/tailwind-classes.test.ts'));
}

/**
 * `border-white/` with nothing after the slash. Matches a slash followed by a
 * quote, whitespace, or backtick — i.e. the modifier was never given a value.
 */
const EMPTY_MODIFIER = /(?:border|bg|text|ring|from|via|to|divide|shadow|outline|decoration|placeholder|accent|caret|fill|stroke)-(?:white|black)\/(?=["'`\s])/;

/**
 * Two opacity modifiers stacked on one utility. Tailwind parses neither, so
 * the class compiles to nothing and the surface it was meant to paint is
 * transparent.
 *
 * Both halves can be plain (`ring-white/30/40`) or arbitrary
 * (`bg-white/[0.04]/70`, `hover:bg-white/90/[0.04]`, `bg-white/[0.02]/[0.98]`),
 * and this codebase has had all four permutations at once. Earlier versions of
 * this guard matched only `\d+/\d+`, then only `[…]/\d+`, and each narrower
 * pattern left a live population behind: 52 of the `[…]/\d+` form across 30
 * files, then 6 more of the `\d+/[…]` form on the white close buttons in the
 * links page, both share modals, the store list row and the store sidebar.
 *
 * They are all residue of the scripted colour migration (commit 3fe5698),
 * which rewrote `bg-[#171511]/70` to `bg-white/[0.04]/70` — swapping the
 * colour and leaving the original alpha dangling behind it. The fix is to drop
 * the leftover modifier, matching every sibling the migration handled
 * correctly; multiplying the two would make these surfaces darker than their
 * neighbours.
 *
 * One pattern covering every permutation, so there is no narrower variant left
 * to slip through.
 */
const DOUBLED_MODIFIER = /-(?:white|black)\/(?:\d+|\[[0-9.]+\])\/(?:\d+|\[[0-9.]+\])/;

interface ScanOptions {
  /** Rewrite a line before matching — used to drop comment text. */
  transform?: (line: string) => string;
  /** Skip whole files a rule cannot apply to. */
  skip?: (file: string) => boolean;
}

function findViolations(pattern: RegExp, opts?: ScanOptions): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles()) {
    if (opts?.skip?.(file)) continue;
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted between ls-files and read
    }
    contents.split('\n').forEach((line, i) => {
      const subject = opts?.transform ? opts.transform(line) : line;
      if (pattern.test(subject)) hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

/**
 * `tailwindcss-animate` utilities, which this project does not have.
 *
 * Tailwind v4 here, and `globals.css` is a bare `@import "tailwindcss"` with no
 * `@plugin`, so `animate-in`, `fade-in`, `slide-in-from-*` and `zoom-in-*`
 * match nothing and emit no rule. 54 of them had accumulated across 34 files —
 * every popover, dropdown, toast and modal in the app hard-cut into existence
 * while its markup claimed a considered entrance. Confirmed in the browser, not
 * assumed: a probe element carrying them computes to `animation: none`.
 *
 * The real utilities are in globals.css: `ui-pop`, `ui-pop-up`, `ui-fade-in`,
 * `ui-toast`, `ui-modal-panel`, `ui-scrim`, `ui-drawer-*`. They use the app's
 * own `--dur-*`/`--ease-*` tokens and are switched off under
 * `prefers-reduced-motion`, which the plugin classes never were either.
 *
 * If the plugin is ever genuinely installed, delete this test in the same
 * commit — a guard that outlives its reason is just an obstacle.
 */
const ANIMATE_PLUGIN =
  /(?:^|[\s"'`])(?:[a-z]+:)?(?:animate-(?:in|out)|(?:fade|zoom)-(?:in|out)(?:-\d+)?|slide-(?:in-from|out-to)-(?:top|bottom|left|right)(?:-\d+)?)(?=[\s"'`]|$)/;

/**
 * These classes only ever live in a JSX class string, but the words also appear
 * in prose — this file's own comments included, and a trailing `// zoom-in/out`
 * beside real code. Scanning raw lines reported five comments as violations,
 * so the scan drops comment text before matching. Line comments are stripped
 * only when the line has no quote before them, so a `//` inside a URL or a
 * class string is left alone.
 */
function stripComments(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  const slashes = line.indexOf('//');
  if (slashes > 0 && !/["'`]/.test(line.slice(0, slashes))) return line.slice(0, slashes);
  return line;
}

describe('tailwindcss-animate utilities', () => {
  it('uses none — the plugin is not installed, so they emit no CSS', () => {
    // .css files carry no class strings, only the prose explaining this rule.
    const violations = findViolations(ANIMATE_PLUGIN, {
      transform: stripComments,
      skip: (f) => f.endsWith('.css'),
    });
    expect(
      violations,
      `Found ${violations.length} tailwindcss-animate class(es). The plugin is not installed, so these render no animation at all. Use ui-pop / ui-pop-up / ui-fade-in / ui-toast / ui-modal-panel / ui-drawer-* from globals.css:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

describe('Tailwind opacity modifiers', () => {
  it('has no empty opacity modifiers (e.g. `border-white/` with no value)', () => {
    const violations = findViolations(EMPTY_MODIFIER);
    expect(
      violations,
      `Found ${violations.length} class(es) with an empty opacity modifier. These compile to no CSS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('has no doubled opacity modifiers, in any permutation', () => {
    const violations = findViolations(DOUBLED_MODIFIER);
    expect(
      violations,
      `Found ${violations.length} class(es) with two stacked opacity modifiers. These compile to no CSS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
