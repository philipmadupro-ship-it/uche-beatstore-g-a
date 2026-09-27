/**
 * Find a runnable ffmpeg binary — and remember WHY each candidate failed.
 *
 * Production previews came back as 20–29 MB byte-truncated WAVs instead of
 * ~1 MB MP3s: every path that makes a clip fell back because ffmpeg did not
 * run on Vercel, and nothing said why. The old lookup:
 *   - tried `./node_modules/ffmpeg-static/ffmpeg`, a path RELATIVE to the
 *     process's working directory, which a serverless function does not
 *     promise is the project root;
 *   - never handled a binary that exists but lost its execute bit when the
 *     function was packaged (EACCES) — the documented workaround is to copy
 *     it to /tmp and chmod it there;
 *   - spawned with stderr ignored and swallowed every error, so the reason
 *     reached no log.
 *
 * Pure apart from the injected deps, so every branch is unit-tested.
 */

export interface FfmpegAttempt {
  bin: string;
  exists: boolean | null;
  error: string | null;
  /** Set when the binary only ran after being copied to /tmp and chmod'ed. */
  copiedTo?: string;
}

export interface FfmpegProbe {
  bin: string | null;
  attempts: FfmpegAttempt[];
}

export interface FfmpegProbeDeps {
  /** true / false for a path; null for a bare command name resolved via PATH. */
  exists: (bin: string) => Promise<boolean | null>;
  /** Runs `bin -version`; resolves null on success or an error code/message. */
  run: (bin: string) => Promise<string | null>;
  /** Copies `bin` somewhere writable, marks it executable, returns the new path. */
  copyExecutable: (bin: string) => Promise<string>;
}

const PERMISSION_ERRORS = new Set(['EACCES', 'EPERM']);

export function ffmpegCandidatePaths(opts: {
  envBin?: string | null;
  cwd: string;
  platform: string;
}): string[] {
  const exe = opts.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const rel = `node_modules/ffmpeg-static/${exe}`;
  const join = (base: string) => `${base.replace(/\/+$/, '')}/${rel}`;
  const list = [
    opts.envBin || null,
    join(opts.cwd),
    // Vercel's function root; the traced file lives here even when cwd differs.
    join('/var/task'),
    'ffmpeg',
  ].filter((v): v is string => Boolean(v));
  return [...new Set(list)];
}

export async function probeFfmpeg(candidates: string[], deps: FfmpegProbeDeps): Promise<FfmpegProbe> {
  const attempts: FfmpegAttempt[] = [];
  for (const bin of candidates) {
    const exists = await deps.exists(bin);
    if (exists === false) {
      attempts.push({ bin, exists, error: 'not found' });
      continue;
    }
    const error = await deps.run(bin);
    if (!error) {
      attempts.push({ bin, exists, error: null });
      return { bin, attempts };
    }
    if (exists && PERMISSION_ERRORS.has(error)) {
      try {
        const copy = await deps.copyExecutable(bin);
        const retry = await deps.run(copy);
        if (!retry) {
          attempts.push({ bin, exists, error, copiedTo: copy });
          return { bin: copy, attempts };
        }
        attempts.push({ bin, exists, error: `${error}; copy failed to run: ${retry}`, copiedTo: copy });
      } catch (e) {
        attempts.push({ bin, exists, error: `${error}; copy failed: ${e instanceof Error ? e.message : String(e)}` });
      }
      continue;
    }
    attempts.push({ bin, exists, error });
  }
  return { bin: null, attempts };
}
