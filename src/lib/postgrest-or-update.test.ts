import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** PostgREST rejects `or=` on PATCH/DELETE (#73). Flag `.or(` in one chain with `.update(` / `.delete(`. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('no .or() on an update/delete chain', () => {
  it('finds none', () => {
    const bad: string[] = [];
    for (const f of walk(path.join(process.cwd(), 'src'))) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      // A chain: from `.from(` to the statement's terminating `;`.
      for (const m of src.matchAll(/\.from\([\s\S]*?;/g)) {
        if (/\.or\(/.test(m[0]) && /\.(update|delete)\(/.test(m[0])) {
          const line = src.slice(0, m.index).split('\n').length;
          bad.push(`${path.relative(process.cwd(), f)}:${line}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
