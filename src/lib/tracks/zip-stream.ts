/**
 * Stream a zip of several files without holding them in memory: each entry is
 * opened only when the previous one has finished, and its bytes go straight
 * into the archive. Entries are STORED, not deflated — audio is already
 * compressed (or, for WAV, barely compressible) and deflating a 60 MB master
 * costs seconds of CPU per file on a serverless function.
 *
 * An entry that cannot be opened (a missing object, an upstream error) is
 * left out and reported through `onSkip`, so one bad file never costs the
 * producer the rest of the set.
 */

import { Zip, ZipPassThrough } from 'fflate';

export interface ZipEntrySource {
  name: string;
  /** Size in bytes when known; lets a capped zip skip a file that cannot fit before opening it. */
  size?: number;
  /** Exempt from `maxBytes` (a README that names what was left out). */
  exempt?: boolean;
  open: () => Promise<ReadableStream<Uint8Array> | Uint8Array | null>;
}

export function zipStream(entries: readonly ZipEntrySource[], opts: { onSkip?: (name: string, reason: string) => void; mtime?: Date; maxBytes?: number } = {}): ReadableStream<Uint8Array> {
  const mtime = opts.mtime ?? new Date();
  const maxBytes = opts.maxBytes ?? Infinity;
  let written = 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return; }
        if (chunk.length) controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        for (const entry of entries) {
          if (!entry.exempt && (written >= maxBytes || written + (entry.size ?? 0) > maxBytes)) {
            opts.onSkip?.(entry.name, 'size limit');
            continue;
          }
          let source: ReadableStream<Uint8Array> | Uint8Array | null = null;
          try {
            source = await entry.open();
          } catch (err) {
            opts.onSkip?.(entry.name, err instanceof Error ? err.message : String(err));
            continue;
          }
          if (!source) { opts.onSkip?.(entry.name, 'unavailable'); continue; }
          const file = new ZipPassThrough(entry.name);
          file.mtime = mtime;
          zip.add(file);
          if (source instanceof Uint8Array) {
            written += source.length;
            file.push(source, true);
            continue;
          }
          const reader = source.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.length) { written += value.length; file.push(value); }
          }
          file.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
