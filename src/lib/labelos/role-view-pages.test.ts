import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The pages whose access differs by face ask `pageAllowed`, so they cannot drift from the nav (LABEL-70). */
describe('face-dependent pages use the shared rule', () => {
  for (const [file, page] of [
    ['src/app/(label)/o/[orgSlug]/ar/page.tsx', 'ar'],
    ['src/app/(label)/o/[orgSlug]/rights/legal/page.tsx', 'legal'],
    ['src/app/(label)/o/[orgSlug]/music/page.tsx', 'music'],
    ['src/app/(label)/o/[orgSlug]/releases/page.tsx', 'releases'],
    ['src/app/(label)/o/[orgSlug]/finance/earnings/page.tsx', 'earnings'],
    ['src/app/(label)/o/[orgSlug]/finance/statements/page.tsx', 'statements'],
    ['src/app/(label)/o/[orgSlug]/rights/contracts/page.tsx', 'contracts'],
    ['src/app/(label)/o/[orgSlug]/rights/parties/page.tsx', 'parties'],
    ['src/app/(label)/o/[orgSlug]/creative/page.tsx', 'creative'],
  ] as const) {
    it(`${page} page`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain(`pageAllowed('${page}', viewInputOf(shell))`);
      expect(src).toContain('notFound()');
    });
  }
});
