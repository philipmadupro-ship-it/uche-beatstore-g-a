import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Source guard (same reasoning as `lib/ui/tailwind-classes.test.ts`): the
 * defect class here — a stored profile value interpolated straight into an
 * `href` — compiles, builds and renders fine. It only shows on a visitor's
 * click, and `javascript:` in it is a script-injection vector on public pages.
 * Every creator link must come from `resolveCreatorLink`.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['a handle interpolated into a profile URL', /(?:instagram|twitter|x)\.com\/\$\{/],
  ['a stored URL used as an href', /href[:=]\s*\{?\s*creator\??\.(?:spotify_url|soundcloud_url|website_url)\b/],
  ['a stored email interpolated into mailto:', /mailto:\$\{\s*creator\??\.contact_email/],
];

describe('creator links are resolved, never interpolated', () => {
  const files = execSync('git ls-files --cached --others --exclude-standard -- "src/**/*.ts" "src/**/*.tsx"', { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && f !== 'src/lib/store/social-links.ts');

  it('finds no raw creator-link href in src', () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const [what, re] of FORBIDDEN) if (re.test(line)) hits.push(`${file}:${i + 1} — ${what}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
