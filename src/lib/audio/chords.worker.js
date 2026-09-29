/**
 * Chord detection off the main thread — a CLASSIC worker script, for the same
 * reason as `essentia.worker.js` (read its header): the bundler copies a
 * `new URL('./x', import.meta.url)` target verbatim rather than bundling it,
 * so every script, WASM binary and model file is handed in as a same-origin
 * URL and loaded with importScripts / fetch.
 *
 * Two sources, blended per second (see `chord-extract.ts`):
 *   - Essentia HPCP chroma, from the 44.1 kHz signal.
 *   - Spotify basic-pitch note activations, from the 22.05 kHz signal, run on
 *     tfjs' WASM backend. If any of that fails to load or run, the result is
 *     HPCP alone and `engine` says so.
 *
 * The extraction below MUST match `chord-extract.ts` and `basic-pitch.ts`.
 * `chords-worker.test.ts` runs this file against the real packages and fails
 * if the copies ever disagree.
 *
 * In:  { id, wasmUrl, coreUrl, signal: Float32Array (mono, 44.1 kHz),
 *        basicPitch?: { signal: Float32Array (mono, 22.05 kHz), tfUrl,
 *                       tfWasmUrl, wasmPaths: { [file]: url }, modelUrl,
 *                       weightsUrl } }
 * Out: { id, ok: true, chords, engine, basicPitchError? } | { id, ok: false, error }
 */
var essentia = null;

var SR = 44100;
var FRAME_SIZE = 4096;
var HOP_SIZE = 2048;
var WINDOW_SECONDS = 1;
var PEAK_FLOOR = 0.01;
var SILENCE = 1e-5;
var NOTE_ACTIVATION_FLOOR = 0.3;
var BASS_KEY_MIDI = 52;
var BASS_WEIGHT = 2;
var NOTE_WEIGHT = 0.75;
var MIN_TRIAD_SHARE = 0.45;
var PITCH_CLASSES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

// basic-pitch.ts
var BP_SAMPLE_RATE = 22050;
var BP_FFT_HOP = 256;
var BP_FPS = Math.floor(BP_SAMPLE_RATE / BP_FFT_HOP);
var BP_FRAME_SECONDS = BP_FFT_HOP / BP_SAMPLE_RATE;
var BP_KEYS = 88;
var BP_AUDIO_N_SAMPLES = BP_SAMPLE_RATE * 2 - BP_FFT_HOP;
var BP_OVERLAP_OVER_2 = 15;
var BP_OVERLAP_LENGTH_FRAMES = 30 * BP_FFT_HOP;
var BP_HOP_SIZE = BP_AUDIO_N_SAMPLES - BP_OVERLAP_LENGTH_FRAMES;
var BP_FRAMES_OUTPUT = 'Identity_1';

var TEMPLATES = [];
for (var root = 0; root < 12; root++) {
  TEMPLATES.push({ label: PITCH_CLASSES[root], bins: [root, (root + 4) % 12, (root + 7) % 12] });
  TEMPLATES.push({ label: PITCH_CLASSES[root] + 'm', bins: [root, (root + 3) % 12, (root + 7) % 12] });
}

function classifyChroma(chroma) {
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += chroma[i] || 0;
  if (!(sum > 1e-6)) return 'N';
  var best = 'N';
  var bestScore = -1;
  for (var t = 0; t < TEMPLATES.length; t++) {
    var b = TEMPLATES[t].bins;
    var score = ((chroma[b[0]] || 0) + (chroma[b[1]] || 0) + (chroma[b[2]] || 0)) / sum;
    if (score > bestScore) {
      bestScore = score;
      best = TEMPLATES[t].label;
    }
  }
  return bestScore < MIN_TRIAD_SHARE ? 'N' : best;
}

function compactChordTimeline(segments) {
  var merged = [];
  for (var i = 0; i < segments.length; i++) {
    if (merged.length && merged[merged.length - 1].chord === segments[i].chord) continue;
    merged.push(segments[i]);
  }
  while (merged.length && merged[0].chord === 'N') merged.shift();
  while (merged.length && merged[merged.length - 1].chord === 'N') merged.pop();
  return merged;
}

function spectrumMax(spectrum) {
  var max = 0;
  for (var i = 0; i < spectrum.length; i++) if (spectrum[i] > max) max = spectrum[i];
  return max;
}

function newBucket() {
  var acc = new Array(12);
  for (var i = 0; i < 12; i++) acc[i] = 0;
  return { acc: acc, frames: 0, voiced: 0 };
}

function hpcpBuckets(core, signal) {
  var buckets = [];
  for (var start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    var b = Math.floor((start + FRAME_SIZE / 2) / SR / WINDOW_SECONDS);
    var bucket = buckets[b] || (buckets[b] = newBucket());
    bucket.frames++;
    var frame = core.arrayToVector(signal.subarray(start, start + FRAME_SIZE));
    var windowed = core.Windowing(frame, true, FRAME_SIZE, 'blackmanharris62').frame;
    var spectrum = core.Spectrum(windowed, FRAME_SIZE).spectrum;
    var peakFloor = spectrumMax(core.vectorToArray(spectrum)) * PEAK_FLOOR;
    if (peakFloor > SILENCE) {
      var peaks = core.SpectralPeaks(spectrum, peakFloor, 5000, 60, 40, 'frequency', SR);
      var hpcp = core.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
      var chroma = core.vectorToArray(hpcp);
      for (var j = 0; j < 12; j++) bucket.acc[j] += chroma[j] || 0;
      bucket.voiced++;
      peaks.frequencies.delete();
      peaks.magnitudes.delete();
      hpcp.delete();
    }
    frame.delete();
    windowed.delete();
    spectrum.delete();
  }
  return buckets;
}

function noteBuckets(noteFrames, frameSeconds) {
  var buckets = [];
  for (var i = 0; i < noteFrames.length; i++) {
    var row = noteFrames[i];
    var b = Math.floor(((i + 0.5) * frameSeconds) / WINDOW_SECONDS);
    var bucket = buckets[b] || (buckets[b] = newBucket());
    bucket.frames++;
    var active = false;
    for (var k = 0; k < row.length; k++) {
      var p = row[k];
      if (!(p > NOTE_ACTIVATION_FLOOR)) continue;
      bucket.acc[k % 12] += 21 + k < BASS_KEY_MIDI ? p * BASS_WEIGHT : p;
      active = true;
    }
    if (active) bucket.voiced++;
  }
  return buckets;
}

function unitSum(acc) {
  var sum = 0;
  for (var i = 0; i < acc.length; i++) sum += acc[i];
  if (!(sum > 0)) return acc;
  var out = new Array(acc.length);
  for (var j = 0; j < acc.length; j++) out[j] = acc[j] / sum;
  return out;
}

function chordsFromBuckets(hpcp, notes) {
  var count = Math.max(hpcp.length, notes ? notes.length : 0);
  var segments = [];
  for (var b = 0; b < count; b++) {
    var h = hpcp[b];
    var n = notes ? notes[b] : undefined;
    var hVoiced = !!h && h.voiced * 2 >= h.frames;
    var nVoiced = !!n && n.voiced > 0;
    var chord = 'N';
    if (notes) {
      if (hVoiced && nVoiced) {
        var a = unitSum(h.acc);
        var c = unitSum(n.acc);
        var blend = new Array(12);
        for (var j = 0; j < 12; j++) blend[j] = (1 - NOTE_WEIGHT) * a[j] + NOTE_WEIGHT * c[j];
        chord = classifyChroma(blend);
      } else if (hVoiced) {
        chord = classifyChroma(h.acc);
      } else if (nVoiced && n.voiced * 2 >= n.frames) {
        chord = classifyChroma(n.acc);
      }
    } else if (hVoiced) {
      chord = classifyChroma(h.acc);
    }
    segments.push({ time: b * WINDOW_SECONDS, chord: chord });
  }
  return compactChordTimeline(segments);
}

async function basicPitchNoteFrames(tf, model, signal) {
  var nOutput = Math.floor(signal.length * (BP_FPS / BP_SAMPLE_RATE));
  var padded = new Float32Array(BP_OVERLAP_LENGTH_FRAMES / 2 + signal.length);
  padded.set(signal, BP_OVERLAP_LENGTH_FRAMES / 2);
  var windows = Math.max(1, Math.ceil(padded.length / BP_HOP_SIZE));
  var rows = [];
  var win = new Float32Array(BP_AUDIO_N_SAMPLES);
  for (var w = 0; w < windows && rows.length < nOutput; w++) {
    win.fill(0);
    win.set(padded.subarray(w * BP_HOP_SIZE, w * BP_HOP_SIZE + BP_AUDIO_N_SAMPLES));
    var out = tf.tidy(function () {
      var frames = model.execute(tf.tensor3d(win, [1, BP_AUDIO_N_SAMPLES, 1]), BP_FRAMES_OUTPUT);
      return frames
        .slice([0, BP_OVERLAP_OVER_2, 0], [-1, frames.shape[1] - 2 * BP_OVERLAP_OVER_2, -1])
        .reshape([-1, BP_KEYS]);
    });
    var values = await out.array();
    out.dispose();
    for (var r = 0; r < values.length; r++) {
      if (rows.length >= nOutput) break;
      rows.push(values[r]);
    }
  }
  return rows;
}

var bpModel = null;

async function loadBasicPitch(cfg) {
  if (!self.tf) {
    // tfjs' bundled regenerator polyfill assigns this global and, when the
    // assignment throws, falls back to `Function(...)` — an eval a strict CSP
    // refuses. Declaring it first makes the assignment succeed.
    self.regeneratorRuntime = self.regeneratorRuntime || undefined;
    importScripts(cfg.tfUrl, cfg.tfWasmUrl);
  }
  var tf = self.tf;
  if (tf.getBackend() !== 'wasm') {
    tf.wasm.setWasmPaths(cfg.wasmPaths);
    if (!(await tf.setBackend('wasm'))) throw new Error('tfjs WASM backend unavailable');
  }
  if (!bpModel) {
    var json = await (await fetch(cfg.modelUrl)).json();
    var weightData = await (await fetch(cfg.weightsUrl)).arrayBuffer();
    // From memory, not a URL: the bundler renames the weights file, so the
    // relative path inside model.json would not resolve.
    bpModel = await tf.loadGraphModel(tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest[0].weights,
      weightData: weightData,
    }));
  }
  return { tf: tf, model: bpModel };
}

self.onmessage = async function (event) {
  var data = event.data || {};
  try {
    if (!essentia) {
      // The WASM UMD ends with `exports.EssentiaWASM = Module`; a worker has
      // no `exports`, so give it one to write into.
      self.exports = self.exports || {};
      importScripts(data.wasmUrl, data.coreUrl);
      essentia = new self.Essentia(self.exports.EssentiaWASM);
    }
    var hpcp = hpcpBuckets(essentia, data.signal);
    var notes = null;
    var basicPitchError;
    if (data.basicPitch) {
      try {
        var bp = await loadBasicPitch(data.basicPitch);
        notes = noteBuckets(await basicPitchNoteFrames(bp.tf, bp.model, data.basicPitch.signal), BP_FRAME_SECONDS);
      } catch (err) {
        basicPitchError = err && err.message ? err.message : String(err);
      }
    }
    self.postMessage({
      id: data.id,
      ok: true,
      chords: chordsFromBuckets(hpcp, notes),
      engine: notes ? 'essentia+basic-pitch' : 'essentia',
      basicPitchError: basicPitchError,
    });
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
