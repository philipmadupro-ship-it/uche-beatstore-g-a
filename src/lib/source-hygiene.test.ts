import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards against control characters written literally into source files.
 *
 * This is not hypothetical tidiness. While adding a NUL-separated cache key to
 * `useSpectralPeaks`, the separator was written as a RAW NUL BYTE into the .ts
 * file instead of the escape sequence. The consequences were quietly awful:
 *
 *   - `grep` classifies any file containing NUL as binary and silently reports
 *     no matches, so searching the file for its own symbols came back empty.
 *   - Exact-match editing tools could not match the line, because the byte is
 *     invisible in every rendering of it.
 *   - `git diff` degrades to "Binary files differ", making the change
 *     unreviewable.
 *
 * Meanwhile `tsc`, ESLint, the tests and the build were all perfectly happy —
 * a raw NUL inside a string literal is legal TypeScript. So nothing in the
 * normal gate would ever have caught it. Same reasoning as the Tailwind
 * modifier guard in `src/lib/ui/tailwind-classes.test.ts`: source text is the
 * only place this class of defect is visible.
 *
 * Escape sequences are the correct way to express these — they are plain ASCII
 * on disk and behave identically at runtime.
 */

/** Every tracked source file, minus this one (whose regex names the range). */
function sourceFiles(): string[] {
  const out = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.endsWith('src/lib/source-hygiene.test.ts'));
}

/**
 * Control characters that must never appear literally in source.
 *
 * Tab, newline and carriage return are excluded — they are ordinary
 * formatting. Everything else in the C0 range, plus DEL, is a mistake.
 */
const LITERAL_CONTROL_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

describe('source hygiene', () => {
  it('contains no literal control characters (use escape sequences instead)', () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      let contents: string;
      try {
        contents = readFileSync(file, 'utf8');
      } catch {
        continue; // deleted between ls-files and read
      }
      contents.split('\n').forEach((line, i) => {
        const m = LITERAL_CONTROL_CHAR.exec(line);
        if (m) {
          const code = m[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase();
          violations.push(`${file}:${i + 1}  contains U+${code}`);
        }
      });
    }

    expect(
      violations,
      `Found ${violations.length} literal control character(s). These make the file `
      + `binary to grep and unreviewable in git diff. Use escape sequences instead:\n`
      + violations.join('\n'),
    ).toEqual([]);
  });
});
