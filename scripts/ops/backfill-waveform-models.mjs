#!/usr/bin/env node
// Builds the missing `<preview>.wave.bin` waveform models (lib/visuals/waveform-file) for tracks
// that were uploaded before the upload pipeline wrote them.
//
//   node --env-file=.env.local scripts/ops/backfill-waveform-models.mjs [--apply] [--limit N]
//
//  * Dry run unless --apply: it only lists what it would write and prints a summary.
//  * --limit N stops after N files that needed writing (files that already exist do not count).
//  * Store-listed tracks go first, then oldest first. Tracks that already have the file are skipped.
//  * Organization (Label OS) tracks are never touched: their previews are private.
//  * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the R2 variables in the
//    environment, and ffmpeg on PATH (the same one the upload pipeline uses).
//
// The model is built by the app's own TypeScript (buildWaveformModel, band-filter, readoutFromMono),
// not a copy: this script bundles that code on the fly with rolldown (a dependency of vitest) and
// runs the result.

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const out = { apply: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive whole number');
      out.limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = Number(a.slice(8));
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive whole number');
      out.limit = n;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const { build } = await import('rolldown');
  // Inside node_modules so the externals above resolve from the repo's own packages.
  const dir = path.join(root, 'node_modules', '.cache', `wave-backfill-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const outFile = path.join(dir, 'entry.mjs');
  try {
    await build({
      input: path.join(root, 'scripts/ops/waveform-backfill-entry.ts'),
      platform: 'node',
      cwd: root,
      resolve: {
        alias: { '@': path.join(root, 'src'), 'server-only': path.join(root, 'scripts/ops/empty-module.mjs') },
      },
      // Real packages stay external (resolved from node_modules next to the repo).
      external: [/^@aws-sdk\//, /^@supabase\//, /^nanoid/, /^audio-decode/, /^node:/],
      output: { file: outFile, format: 'esm' },
    });
    const mod = await import(pathToFileURL(outFile).href);
    process.exitCode = await mod.main(opts);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
