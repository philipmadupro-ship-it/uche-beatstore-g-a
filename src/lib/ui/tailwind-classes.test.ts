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

/** Every tracked source file we style in. */
function sourceFiles(): string[] {
  const out = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts" "src/**/*.css"', {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out.split('\n').filter(Boolean);
}

/**
 * `border-white/` with nothing after the slash. Matches a slash followed by a
 * quote, whitespace, or backtick — i.e. the modifier was never given a value.
 */
const EMPTY_MODIFIER = /(?:border|bg|text|ring|from|via|to|divide|shadow|outline|decoration|placeholder|accent|caret|fill|stroke)-(?:white|black)\/(?=["'`\s])/;

/**
 * `ring-white/30/40` — two opacity modifiers stacked. Tailwind parses neither.
 */
const DOUBLED_MODIFIER = /-(?:white|black)\/\d+\/\d+/;

function findViolations(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles()) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted between ls-files and read
    }
    contents.split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

describe('Tailwind opacity modifiers', () => {
  it('has no empty opacity modifiers (e.g. `border-white/` with no value)', () => {
    const violations = findViolations(EMPTY_MODIFIER);
    expect(
      violations,
      `Found ${violations.length} class(es) with an empty opacity modifier. These compile to no CSS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('has no doubled opacity modifiers (e.g. `ring-white/30/40`)', () => {
    const violations = findViolations(DOUBLED_MODIFIER);
    expect(
      violations,
      `Found ${violations.length} class(es) with two stacked opacity modifiers. These compile to no CSS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
