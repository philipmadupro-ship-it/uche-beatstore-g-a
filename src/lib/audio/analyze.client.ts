/**
 * Browser-only audio analysis using Essentia.js WASM.
 * Safe to import in client components — does NOT pull in audio-decode/music-tempo.
 *
 * Two entry points:
 *   - `analyzeAudio(file)`         → during upload (we already have the File)
 *   - `analyzeAudioFromUrl(url)`   → for Re-analyze on existing tracks
 *
 * Both share a single Essentia pipeline. The server route at
 * /api/tracks/[id]/analyze prioritizes client-provided features over its
 * own server-side decode — Essentia in the browser is more accurate than
 * the Node-side music-tempo / Krumhansl heuristics, so this is the
 * preferred path when the browser can read the audio.
 *
 * When the browser can't decode (CORS / unsupported codec / very large
 * file), the caller falls back to the server endpoint without features
 * and lets the server's pipeline take a swing.
 */

export interface AudioFeatures {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  loudness: number | null;
  duration: number | null;
}

const EMPTY: AudioFeatures = { bpm: null, key: null, scale: null, loudness: null, duration: null };

interface EssentiaRuntime {
  arrayToVector(input: Float32Array): unknown;
  RhythmExtractor2013(signal: unknown): { bpm: number };
  KeyExtractor(signal: unknown): { key?: string | null; scale?: string | null };
  LoudnessEBUR128(left: unknown, right: unknown): { integratedLoudness: number };
  delete(): void;
}

type EssentiaFactory = () => Promise<EssentiaRuntime>;

interface EssentiaModule {
  EssentiaWASM: EssentiaFactory | { EssentiaWASM?: EssentiaFactory };
}

export async function analyzeAudio(file: File): Promise<AudioFeatures> {
  if (typeof window === 'undefined') return { ...EMPTY };
  return runEssentia(await file.arrayBuffer());
}

/**
 * Fetch an audio URL and analyze it in the browser. We route through the
 * same-origin /api/audio proxy so cross-origin R2 URLs don't trip CORS,
 * and so any signed-URL logic on the server (presigning, allowlist) is
 * applied transparently.
 */
export async function analyzeAudioFromUrl(rawUrl: string): Promise<AudioFeatures> {
  if (typeof window === 'undefined') return { ...EMPTY };

  // Same-origin local paths go direct; everything else proxies through
  // /api/audio so we never have to fight R2 CORS in the browser.
  const url = rawUrl.startsWith('/')
    ? rawUrl
    : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Audio fetch for analysis failed:', err);
    return { ...EMPTY };
  }
  return runEssentia(buffer);
}

async function runEssentia(buffer: ArrayBuffer): Promise<AudioFeatures> {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const channelData = decoded.getChannelData(0); // Float32Array
    const duration = Math.round(decoded.duration);
    await ctx.close();
    ctx = null;

    // Offload heavy Essentia.js calculations to a Web Worker so we don't lock the UI main thread!
    const workerResult = await runEssentiaInWorker(channelData);

    return {
      bpm: workerResult.bpm,
      key: workerResult.key,
      scale: workerResult.scale,
      loudness: workerResult.loudness,
      duration,
    };
  } catch (err) {
    console.warn('Offloaded Essentia.js worker failed, trying local fallback:', err);
    if (ctx) {
      try { await ctx.close(); } catch {}
    }

    // Fallback: local direct main-thread analysis so it NEVER breaks
    try {
      const { EssentiaWASM } = (await import('essentia.js') as unknown as EssentiaModule);
      const factory = typeof EssentiaWASM === 'function'
        ? EssentiaWASM
        : EssentiaWASM.EssentiaWASM;
      if (!factory) throw new Error('Essentia WASM factory not found');
      const essentia = await factory();

      const fallbackCtx = new AudioContext();
      const decoded = await fallbackCtx.decodeAudioData(buffer.slice(0));
      const signal = essentia.arrayToVector(decoded.getChannelData(0));

      const rhythm = essentia.RhythmExtractor2013(signal);
      const keyData = essentia.KeyExtractor(signal);

      let loudness: number | null = null;
      try {
        const l = essentia.LoudnessEBUR128(signal, signal);
        loudness = +l.integratedLoudness.toFixed(1);
      } catch {}

      essentia.delete();
      await fallbackCtx.close();

      return {
        bpm: Math.round(rhythm.bpm),
        key: keyData.key || null,
        scale: keyData.scale || null,
        loudness,
        duration: Math.round(decoded.duration),
      };
    } catch (fallbackErr) {
      console.warn('Essentia fallback failed too:', fallbackErr);
      // Try to at least return duration
      try {
        const fallbackCtx = new AudioContext();
        const decoded = await fallbackCtx.decodeAudioData(buffer.slice(0));
        const duration = Math.round(decoded.duration);
        await fallbackCtx.close();
        return { bpm: null, key: null, scale: null, loudness: null, duration };
      } catch {
        return { ...EMPTY };
      }
    }
  }
}

interface WorkerResult {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  loudness: number | null;
}

function runEssentiaInWorker(channelData: Float32Array): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    // Generate inline worker script code
    const workerCode = `
      self.onmessage = async (e) => {
        try {
          const { channelData, essentiaUrl } = e.data;
          self.importScripts(essentiaUrl);
          
          const factory = self.EssentiaWASM.EssentiaWASM ?? self.EssentiaWASM;
          const essentia = await factory();
          
          const signal = essentia.arrayToVector(channelData);
          
          const rhythm = essentia.RhythmExtractor2013(signal);
          const keyData = essentia.KeyExtractor(signal);
          
          let loudness = null;
          try {
            const l = essentia.LoudnessEBUR128(signal, signal);
            loudness = +l.integratedLoudness.toFixed(1);
          } catch (lErr) {}
          
          essentia.delete();
          
          self.postMessage({
            success: true,
            bpm: Math.round(rhythm.bpm),
            key: keyData.key || null,
            scale: keyData.scale || null,
            loudness
          });
        } catch (err) {
          self.postMessage({ success: false, error: err.message });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    // Using CDN essentia-core bundle
    const essentiaUrl = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.js';

    worker.onmessage = (e) => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      if (e.data.success) {
        resolve({
          bpm: e.data.bpm,
          key: e.data.key,
          scale: e.data.scale,
          loudness: e.data.loudness,
        });
      } else {
        reject(new Error(e.data.error || 'Worker execution failed'));
      }
    };

    worker.onerror = (err) => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      reject(err);
    };

    // Pass as Transferable Object to avoid copying large array buffers!
    worker.postMessage({ channelData, essentiaUrl }, [channelData.buffer]);
  });
}
