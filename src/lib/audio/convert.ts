import 'server-only';
// Node built-ins are dynamic-imported inside the functions below. Static
// imports here break Turbopack's app-route bundling — its stub for
// `fs` doesn't expose the `promises` namespace, and we don't want this
// module ever pulled into a non-Node bundle anyway.
import {
  ffmpegCandidatePaths,
  probeFfmpeg,
  type FfmpegProbe,
  type FfmpegProbeDeps,
} from './ffmpeg-locate';

/**
 * Server-side audio conversion via ffmpeg.
 *
 * Used as a second-chance decoder in the analyze pipeline: when the
 * pure-JS `audio-decode` package can't handle a file (weird MP3
 * encodings, AAC-in-MP4, certain FLAC variants, opus, anything with
 * unusual container metadata), we shell out to ffmpeg to transcode it
 * to a vanilla 16-bit PCM WAV @ 44.1 kHz mono. `audio-decode` handles
 * vanilla WAVs 100% of the time, so the retry virtually always succeeds.
 *
 * Why ffmpeg rather than a pure-JS approach:
 *   - The point of the fallback is to handle formats the pure-JS path
 *     CAN'T. Adding more pure-JS decoders just gives us bigger gaps.
 *   - ffmpeg is universally available on dev machines (`brew install
 *     ffmpeg`) and supported via layers on Vercel / fly.io / Render.
 *   - WAV output is the simplest thing we can hand off to audio-decode.
 *
 * If ffmpeg isn't installed, this returns null and the caller falls
 * through to the existing "couldn't decode" path. We don't make ffmpeg
 * mandatory — only available as a strict improvement when present.
 */

/**
 * Augmented PATH for spawning ffmpeg. Necessary because GUI-launched dev
 * servers (VSCode, Cursor, Claude Code) often inherit a stripped PATH
 * that doesn't include Homebrew (`/opt/homebrew/bin` on Apple Silicon,
 * `/usr/local/bin` on Intel) — `which ffmpeg` works in the user's
 * terminal but `spawn('ffmpeg')` fails. We union the current PATH with
 * the common install locations so the binary is found regardless of how
 * the Node process was launched.
 */
function ffmpegEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  const merged = Array.from(new Set([...current, ...extra])).join(':');
  return { ...process.env, PATH: merged };
}

/**
 * Locating the binary: lib/audio/ffmpeg-locate. We never import
 * `ffmpeg-static` (its dynamic require makes Turbopack's NFT tracer pull in
 * the whole project); next.config.ts traces the binary file itself.
 *
 * Positive results cache forever; NEGATIVE results expire after 60s so a
 * transient failure does not strand the process. The last probe is kept for
 * `ffmpegStatus()`, which is how a producer can see WHY it failed.
 */
let ffmpegBinCache: string | null = null;
let ffmpegAvailable: boolean | null = null;
let ffmpegCheckedAt = 0;
let lastProbe: FfmpegProbe | null = null;
const FFMPEG_NEG_TTL_MS = 60_000;

async function probeDeps(): Promise<FfmpegProbeDeps> {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  return {
    exists: async (bin) => {
      if (!bin.includes('/')) return null; // bare name, resolved through PATH
      try { await fs.access(bin); return true; } catch { return false; }
    },
    run: (bin) => new Promise<string | null>((resolve) => {
      let stderr = '';
      let proc;
      try {
        proc = spawn(bin, ['-version'], { stdio: ['ignore', 'ignore', 'pipe'], env: ffmpegEnv() });
      } catch (e) {
        resolve((e as NodeJS.ErrnoException).code ?? String(e));
        return;
      }
      proc.stderr?.on('data', (d: Buffer) => { if (stderr.length < 400) stderr += d.toString(); });
      proc.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
      proc.on('exit', (code, signal) => resolve(
        code === 0 ? null : `exit ${code ?? signal}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`,
      ));
    }),
    copyExecutable: async (bin) => {
      const dest = path.join(os.tmpdir(), 'ffmpeg-bin');
      await fs.copyFile(bin, dest);
      await fs.chmod(dest, 0o755);
      return dest;
    },
  };
}

async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable === true) return true;
  if (ffmpegAvailable === false && Date.now() - ffmpegCheckedAt < FFMPEG_NEG_TTL_MS) {
    return false;
  }
  const candidates = ffmpegCandidatePaths({
    envBin: process.env.FFMPEG_BIN,
    cwd: process.cwd(),
    platform: process.platform,
  });
  lastProbe = await probeFfmpeg(candidates, await probeDeps());
  ffmpegBinCache = lastProbe.bin;
  ffmpegAvailable = Boolean(lastProbe.bin);
  ffmpegCheckedAt = Date.now();
  if (!ffmpegAvailable) console.warn('ffmpeg unavailable', JSON.stringify(lastProbe.attempts));
  return ffmpegAvailable;
}

/** Whether ffmpeg runs here, which binary, and why each candidate failed. */
export async function ffmpegStatus(): Promise<{ available: boolean } & FfmpegProbe> {
  const available = await checkFfmpeg();
  return { available, bin: ffmpegBinCache, attempts: lastProbe?.attempts ?? [] };
}

async function runFfmpegToBuffer(
  args: string[],
  input: Buffer,
  timeoutMs: number,
): Promise<Buffer | null> {
  const { spawn } = await import('node:child_process');
  const proc = spawn(ffmpegBinCache || 'ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: ffmpegEnv(),
  });

  const chunks: Buffer[] = [];
  let settled = false;

  return new Promise<Buffer | null>((resolve) => {
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve(value);
    };

    const killer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      finish(null);
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', () => finish(null));
    proc.on('exit', (code) => {
      finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null);
    });

    proc.stdin.on('error', () => {
      try { proc.kill('SIGKILL'); } catch {}
      finish(null);
    });
    proc.stdin.end(input);
  });
}

/**
 * Convert an input audio buffer (any format ffmpeg supports) to a WAV
 * buffer suitable for handoff to `audio-decode`.
 *
 * Returns `null` when:
 *   - ffmpeg isn't installed on this host
 *   - ffmpeg exits non-zero (corrupt input, unsupported codec)
 *   - filesystem ops fail (rare; usually permissions on /tmp)
 *
 * Output spec: PCM signed 16-bit little-endian, 44.1 kHz, mono. Mono
 * because we only analyze a single channel anyway — saves ~50%.
 */
export async function convertToWavBuffer(input: Buffer): Promise<Buffer | null> {
  if (!(await checkFfmpeg())) {
    console.warn('ffmpeg not available — falling back to "couldn\'t decode" path. Install ffmpeg to enable conversion.');
    return null;
  }

  try {
    return await runFfmpegToBuffer([
        '-i', 'pipe:0',
        '-ac', '1',     // mono
        '-ar', '44100', // 44.1 kHz
        '-c:a', 'pcm_s16le', // 16-bit signed PCM
        '-f', 'wav',
        'pipe:1',
      ],
      input,
      // Hard timeout — a malicious / corrupt file shouldn't be able to
      // hang the route forever. 30 seconds is plenty for any realistic
      // music length when transcoding to PCM.
      30_000,
    );
  } catch (err) {
    console.warn('ffmpeg fallback errored:', err);
    return null;
  }
}

/**
 * Create the public listening derivative for a private master.
 *
 * 96 kbps MP3 is intentionally good enough for store discovery while being
 * materially less useful than the purchased WAV/stems. The master never needs
 * to leave private storage for storefront playback.
 */
export async function createPreviewMp3Buffer(input: Buffer): Promise<Buffer | null> {
  if (!(await checkFfmpeg())) {
    console.warn('ffmpeg not available - public preview was not generated.');
    return null;
  }

  try {
    return await runFfmpegToBuffer([
        '-i', 'pipe:0',
        '-vn',
        '-map_metadata', '-1',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        '-f', 'mp3',
        'pipe:1',
      ],
      input,
      60_000,
    );
  } catch (err) {
    console.warn('Preview conversion failed:', err);
    return null;
  }
}

/**
 * Create the PROTECTED public preview clip: the first `previewSeconds` of the
 * master, transcoded to a small 96 kbps stereo MP3 in a single ffmpeg pass.
 *
 * This replaces the byte-truncation approach (`makeTruncatedPreview`) for the
 * common case: a WAV master byte-truncates to a still-huge ~13 MB WAV, whereas
 * a 75 s 96 kbps MP3 is ~0.9 MB — fast to load in the share/store player and
 * useless as a full-beat rip. Works for any input ffmpeg can read (wav, mp3,
 * flac, aiff, m4a…). Returns null when ffmpeg is unavailable or the input is
 * unreadable, so callers can fall back to `makeTruncatedPreview`.
 */
export async function makePreviewMp3Buffer(
  input: Buffer,
  previewSeconds = 75,
): Promise<Buffer | null> {
  if (!(await checkFfmpeg())) {
    console.warn('ffmpeg not available - mp3 preview was not generated.');
    return null;
  }

  const seconds = Math.max(1, Math.floor(previewSeconds));

  try {
    return await runFfmpegToBuffer([
        '-t', String(seconds), // keep only the first N seconds (the truncation)
        '-i', 'pipe:0',
        '-vn',
        '-map_metadata', '-1',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        '-f', 'mp3',
        'pipe:1',
      ],
      input,
      60_000,
    );
  } catch (err) {
    console.warn('mp3 preview conversion failed:', err);
    return null;
  }
}

/**
 * Transcode a whole master to the MP3 a lease buyer is sold: 320 kbps CBR
 * stereo at 44.1 kHz, metadata stripped. Unlike the 96 kbps public preview this
 * is the deliverable, so quality is the point; the master stays in private
 * storage. Works for any input ffmpeg reads (wav, flac, aiff, m4a, ogg).
 * Returns null when ffmpeg is unavailable or the input is unreadable.
 */
export async function makeDeliveryMp3Buffer(input: Buffer): Promise<Buffer | null> {
  if (!(await checkFfmpeg())) {
    console.warn('ffmpeg not available - delivery mp3 was not generated.');
    return null;
  }
  try {
    return await runFfmpegToBuffer([
        '-i', 'pipe:0',
        '-vn',
        '-map_metadata', '-1',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-f', 'mp3',
        'pipe:1',
      ],
      input,
      180_000,
    );
  } catch (err) {
    console.warn('delivery mp3 conversion failed:', err);
    return null;
  }
}

/** Exposed for tests / diagnostics. */
export async function isFfmpegInstalled(): Promise<boolean> {
  return checkFfmpeg();
}
