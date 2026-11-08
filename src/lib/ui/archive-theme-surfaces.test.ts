import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The light `de-roche-archive` layer re-points `text-white/NN` to the dark text token inside `.labelos-shell`.
 * A surface written as a near-black literal (`bg-[#0D0D0A]`) is not a token, so it stayed dark while its text
 * turned dark too: about 1.03:1 on the active nav item and the roster cards (review G18 / G19). Every near-black
 * literal surface used by the shell's components must therefore be re-pointed in that layer.
 */
const root = path.resolve(__dirname, '../../..');
const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const archive = css.slice(css.indexOf('Label OS in the light archive theme'));

function walk(p: string): string[] {
  if (statSync(p).isFile()) return /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p) ? [p] : [];
  return readdirSync(p).flatMap((n) => walk(path.join(p, n)));
}
const scanned = [
  'src/components/labelos',
  'src/components/artists',
  'src/components/nav/TopBar.tsx',
  'src/app/(label)',
].flatMap((p) => walk(path.join(root, p)));

function nearBlackNeutral(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) < 0x20 && Math.max(r, g, b) - Math.min(r, g, b) < 8;
}

describe('de-roche-archive: near-black literal surfaces in the Label OS shell', () => {
  const used = new Set<string>();
  for (const f of scanned) {
    for (const m of readFileSync(f, 'utf8').matchAll(/bg-\[#([0-9a-fA-F]{6})\]/g)) {
      if (nearBlackNeutral(m[1])) used.add(m[1].toLowerCase());
    }
  }

  it('finds the literals this guard exists for', () => {
    expect(used.has('0d0d0a')).toBe(true);
  });

  it.each([...used])('re-points bg-[#%s] to a surface token in the archive layer', (hex) => {
    const re = new RegExp(`\\.labelos-shell[^{]*\\[class\\*="bg-\\[#${hex}\\]"\\]`, 'i');
    expect(archive).toMatch(re);
  });
});
