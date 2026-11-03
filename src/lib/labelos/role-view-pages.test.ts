import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The pages whose access differs by face ask `pageAllowed`, so they cannot drift from the nav (LABEL-70). */
describe('face-dependent pages use the shared rule', () => {
  for (const [file, page] of [
    ['src/app/(label)/o/[orgSlug]/ar/page.tsx', 'ar'],
    ['src/app/(label)/o/[orgSlug]/rights/legal/page.tsx', 'legal'],
  ] as const) {
    it(`${page} page`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain(`pageAllowed('${page}', viewInputOf(shell))`);
      expect(src).toContain('notFound()');
    });
  }
});
