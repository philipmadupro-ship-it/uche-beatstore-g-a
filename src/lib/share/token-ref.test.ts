import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tokenRef } from './token-ref';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('tokenRef', () => {
  it('is 8 hex chars, stable, and not the token', () => {
    const r = tokenRef('secret-token');
    expect(r).toMatch(/^[0-9a-f]{8}$/);
    expect(tokenRef('secret-token')).toBe(r);
    expect(tokenRef('other')).not.toBe(r);
  });
});

describe('share routes never log a raw token', () => {
  const root = path.join(process.cwd(), 'src/app/api');
  const files = [...walk(path.join(root, 'share')), ...walk(path.join(root, 'projects/share'))];
  it('scans a non-empty set', () => expect(files.length).toBeGreaterThan(3));
  it('has no log call carrying `token` as a key or shorthand', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const re = /\blog\.(?:info|warn|error|debug)\s*\(([\s\S]*?)\)\s*;?/g;
      for (const m of src.matchAll(re)) {
        if (/[{,]\s*token\s*(?:,|\}|:)/.test(m[1])) bad.push(`${path.relative(process.cwd(), f)}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
