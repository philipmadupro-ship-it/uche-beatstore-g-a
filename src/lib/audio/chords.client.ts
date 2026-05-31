/**
 * Browser-only chord detection using Essentia.js HPCP framewise chromagram
 * + 24-template (major/minor) matching. No recurring cost — runs entirely in
 * the visitor's browser in a Web Worker, mirroring analyze.client.ts.
 *
 * Output: an ordered array of { time, chord } segments where `chord` is a
 * label like "C", "Am", "F#m" (or "N" for no/low-confidence chord). Adjacent
 * identical chords are merged so the timeline is compact.
 *
 * NOTE: HPCP bin 0 corresponds to the reference pitch class (A at 440 Hz in
 * Essentia's default config). If a future calibration shows a constant
 * semitone offset, adjust PITCH_CLASSES rotation — every chord would be wrong
 * by the same fixed interval, which is the tell-tale sign.
 */

export interface ChordSegment {
  time: number;
  chord: string;
}

export async function detectChordsFromUrl(rawUrl: string): Promise<ChordSegment[]> {
  if (typeof window === 'undefined') return [];

  const url = rawUrl.startsWith('/') ? rawUrl : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Chord detection: audio fetch failed', err);
    return [];
  }

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const channelData = decoded.getChannelData(0).slice(0); // copy → transferable
    const sampleRate = decoded.sampleRate;
    await ctx.close();
    ctx = null;
    return await runChordWorker(channelData, sampleRate);
  } catch (err) {
    console.warn('Chord detection failed', err);
    if (ctx) {
      try { await ctx.close(); } catch {}
    }
    return [];
  }
}

function runChordWorker(channelData: Float32Array, sampleRate: number): Promise<ChordSegment[]> {
  return new Promise((resolve) => {
    const workerCode = `
      // Pitch classes ordered from HPCP bin 0 (A at 440Hz reference).
      const PC = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];

      // Binary chord templates over 12 pitch classes (relative to root).
      // Major = root + major third (4) + fifth (7); minor = root + (3) + (7).
      function buildTemplates() {
        const out = [];
        for (let root = 0; root < 12; root++) {
          const maj = new Array(12).fill(0);
          maj[root] = 1; maj[(root + 4) % 12] = 1; maj[(root + 7) % 12] = 1;
          out.push({ label: PC[root], v: maj });
          const min = new Array(12).fill(0);
          min[root] = 1; min[(root + 3) % 12] = 1; min[(root + 7) % 12] = 1;
          out.push({ label: PC[root] + 'm', v: min });
        }
        return out;
      }

      function classify(chroma, templates) {
        const sum = chroma.reduce((a, b) => a + b, 0);
        if (sum < 1e-6) return 'N';
        // Normalize chroma to unit sum for scale-invariant correlation.
        const norm = chroma.map((x) => x / sum);
        let best = 'N', bestScore = -1;
        for (const t of templates) {
          let dot = 0;
          for (let i = 0; i < 12; i++) dot += norm[i] * t.v[i];
          if (dot > bestScore) { bestScore = dot; best = t.label; }
        }
        // Require the matched triad to carry a meaningful share of energy.
        return bestScore < 0.45 ? 'N' : best;
      }

      self.onmessage = async (e) => {
        try {
          const { channelData, sampleRate, essentiaUrl } = e.data;
          self.importScripts(essentiaUrl);
          const factory = self.EssentiaWASM.EssentiaWASM ?? self.EssentiaWASM;
          const essentia = await factory();

          const frameSize = 4096;
          const hopSize = 2048;
          const templates = buildTemplates();

          const frames = essentia.FrameGenerator(channelData, frameSize, hopSize);
          const perFrame = []; // { time, chroma:[12] }
          for (let i = 0; i < frames.size(); i++) {
            const frame = frames.get(i);
            const windowed = essentia.Windowing(frame, true, frameSize, 'hann').frame;
            const spectrum = essentia.Spectrum(windowed).spectrum;
            const peaks = essentia.SpectralPeaks(spectrum, 0, 5000, 100, 0, 'frequency', sampleRate);
            const hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
            const chroma = essentia.vectorToArray(hpcp);
            const time = (i * hopSize) / sampleRate;
            perFrame.push({ time, chroma: Array.from(chroma) });
          }
          frames.delete();
          essentia.delete();

          // Aggregate into ~1s windows (majority chroma sum) to denoise.
          const windowSec = 1.0;
          const segments = [];
          let bucketStart = 0;
          let acc = new Array(12).fill(0);
          let bucketTime = 0;
          const flush = (tEnd) => {
            const label = classify(acc, templates);
            segments.push({ time: +bucketTime.toFixed(2), chord: label });
          };
          for (let i = 0; i < perFrame.length; i++) {
            const f = perFrame[i];
            if (f.time - bucketStart >= windowSec && acc.some((x) => x > 0)) {
              flush(f.time);
              bucketStart = f.time;
              bucketTime = f.time;
              acc = new Array(12).fill(0);
            }
            if (acc.every((x) => x === 0)) bucketTime = f.time;
            for (let j = 0; j < 12; j++) acc[j] += f.chroma[j] || 0;
          }
          if (acc.some((x) => x > 0)) flush(perFrame.length ? perFrame[perFrame.length - 1].time : 0);

          // Merge consecutive identical chords; drop leading/trailing 'N'.
          const merged = [];
          for (const s of segments) {
            if (merged.length && merged[merged.length - 1].chord === s.chord) continue;
            merged.push(s);
          }
          while (merged.length && merged[0].chord === 'N') merged.shift();
          while (merged.length && merged[merged.length - 1].chord === 'N') merged.pop();

          self.postMessage({ success: true, chords: merged });
        } catch (err) {
          self.postMessage({ success: false, error: (err && err.message) || String(err) });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    const essentiaUrl = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.js';

    const cleanup = () => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
    };

    worker.onmessage = (ev) => {
      cleanup();
      if (ev.data?.success && Array.isArray(ev.data.chords)) {
        resolve(ev.data.chords as ChordSegment[]);
      } else {
        console.warn('Chord worker error:', ev.data?.error);
        resolve([]);
      }
    };
    worker.onerror = (err) => {
      cleanup();
      console.warn('Chord worker crashed:', err.message);
      resolve([]);
    };

    worker.postMessage({ channelData, sampleRate, essentiaUrl }, [channelData.buffer]);
  });
}
