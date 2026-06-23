import 'server-only';
// Node built-ins are dynamic-imported inside the functions below. Static
// imports here break Turbopack's app-route bundling — its stub for
// `fs` doesn't expose the `promises` namespace, and we don't want this
// module ever pulled into a non-Node bundle anyway.

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
 * Detect ffmpeg availability. Positive results cache forever (the binary
 * isn't going to vanish mid-process); NEGATIVE results expire after
 * 60s so a transient flake (zombie pid, slow brew install completing
 * mid-dev-session, etc.) doesn't permanently strand the analyze flow
 * for the rest of the process lifetime.
 */
let ffmpegAvailable: boolean | null = null;
let ffmpegCheckedAt = 0;
const FFMPEG_NEG_TTL_MS = 60_000;

async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable === true) return true;
  if (ffmpegAvailable === false && Date.now() - ffmpegCheckedAt < FFMPEG_NEG_TTL_MS) {
    return false;
  }
  const { spawn } = await import('child_process');
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore', env: ffmpegEnv() });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
  ffmpegCheckedAt = Date.now();
  return ffmpegAvailable;
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

  // Dynamic imports keep Node built-ins out of any bundler's reach.
  const { spawn } = await import('child_process');
  const { promises: fs } = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const crypto = await import('crypto');

  // Unique temp paths so concurrent analyses don't clobber each other.
  // Crypto-random suffix > pid because the same pid can run multiple
  // converts in parallel under serverless concurrency.
  const id = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(os.tmpdir(), `ag-in-${id}`);
  const outPath = path.join(os.tmpdir(), `ag-out-${id}.wav`);

  try {
    await fs.writeFile(inPath, input);

    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y',           // overwrite output silently
        '-i', inPath,
        '-ac', '1',     // mono
        '-ar', '44100', // 44.1 kHz
        '-c:a', 'pcm_s16le', // 16-bit signed PCM
        '-f', 'wav',
        outPath,
      ], { stdio: 'ignore', env: ffmpegEnv() });
      // Hard timeout — a malicious / corrupt file shouldn't be able to
      // hang the route forever. 30 seconds is plenty for any realistic
      // music length when transcoding to PCM.
      const killer = setTimeout(() => proc.kill('SIGKILL'), 30_000);
      proc.on('exit', (code) => {
        clearTimeout(killer);
        resolve(code === 0);
      });
      proc.on('error', () => {
        clearTimeout(killer);
        resolve(false);
      });
    });

    if (!ok) {
      console.warn('ffmpeg conversion failed for input — file likely corrupt or codec not supported.');
      return null;
    }

    const out = await fs.readFile(outPath);
    return out;
  } catch (err) {
    console.warn('ffmpeg fallback errored:', err);
    return null;
  } finally {
    // Best-effort cleanup; ignore ENOENT if either file never got written.
    await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)]);
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

  const { spawn } = await import('child_process');
  const { promises: fs } = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const crypto = await import('crypto');

  const id = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(os.tmpdir(), `ag-preview-in-${id}`);
  const outPath = path.join(os.tmpdir(), `ag-preview-out-${id}.mp3`);

  try {
    await fs.writeFile(inPath, input);
    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-i', inPath,
        '-vn',
        '-map_metadata', '-1',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        '-f', 'mp3',
        outPath,
      ], { stdio: 'ignore', env: ffmpegEnv() });
      const killer = setTimeout(() => proc.kill('SIGKILL'), 60_000);
      proc.on('exit', (code) => {
        clearTimeout(killer);
        resolve(code === 0);
      });
      proc.on('error', () => {
        clearTimeout(killer);
        resolve(false);
      });
    });

    if (!ok) return null;
    return await fs.readFile(outPath);
  } catch (err) {
    console.warn('Preview conversion failed:', err);
    return null;
  } finally {
    await Promise.allSettled([fs.unlink(inPath), fs.unlink(outPath)]);
  }
}

/** Exposed for tests / diagnostics. */
export async function isFfmpegInstalled(): Promise<boolean> {
  return checkFfmpeg();
}
