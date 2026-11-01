/**
 * LABEL-72 — the master's reference is unreachable from every public release route. The runtime proof is in
 * routes.test.ts (no response mentions a stored reference); this is the structural one: no file under the public
 * routes, or the public page that plays them, can name a master reference or open a stored object other than
 * the promoted preview and the private derivative. A new import here that reads masters fails this test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [path.resolve(__dirname), path.resolve(__dirname, '../../../store/releases')];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('public release routes cannot reach a master', () => {
  const files = roots.flatMap(sources);
  it('finds the routes it is guarding', () => {
    expect(files.some((f) => f.endsWith(path.join('audio', '[itemId]', 'route.ts')))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(5);
  });
  it.each(files.map((f) => [path.relative(path.resolve(__dirname, '../../../..'), f), f]))('%s names no master reference and opens no master', (_name, file) => {
    const src = fs.readFileSync(file as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/master_audio_ref|master_preview_ref|orgAudioSourceAllowed|streamAudioSource\b|readStoredObject|getStoredObject|getPresignedUrl/);
    // The page reads the public track's same-origin `audio_url`; only the routes must never touch a stored column.
    if ((file as string).endsWith('route.ts')) expect(src).not.toMatch(/\.audio_url|\.wav_url|audio_url\s*:/);
  });
});
