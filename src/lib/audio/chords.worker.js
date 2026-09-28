/**
 * Essentia chord detection off the main thread — a CLASSIC worker script,
 * for the same reason as `essentia.worker.js` (read its header): the bundler
 * copies a `new URL('./x', import.meta.url)` target verbatim rather than
 * bundling it, so the two essentia.js UMD builds are handed in as same-origin
 * `wasmUrl` / `coreUrl` and loaded with importScripts. (The old worker was a
 * blob that fetched essentia.js from jsDelivr, which the CSP does not list,
 * then called a factory that file never defines.)
 *
 * The extraction below MUST match `chord-extract.ts#extractChords`.
 * `chords-worker.test.ts` runs this file against the real package and fails
 * if the two ever disagree.
 *
 * In:  { id, wasmUrl, coreUrl, signal: Float32Array (mono, 44.1 kHz) }
 * Out: { id, ok: true, chords } | { id, ok: false, error }
 */
var essentia = null;

var SR = 44100;
var FRAME_SIZE = 4096;
var HOP_SIZE = 2048;
var WINDOW_SECONDS = 1;
var PEAK_FLOOR = 0.01;
var SILENCE = 1e-5;
var MIN_TRIAD_SHARE = 0.45;
var PITCH_CLASSES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

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

function newChroma() {
  var a = new Array(12);
  for (var i = 0; i < 12; i++) a[i] = 0;
  return a;
}

function spectrumMax(spectrum) {
  var max = 0;
  for (var i = 0; i < spectrum.length; i++) if (spectrum[i] > max) max = spectrum[i];
  return max;
}

function extractChords(core, signal) {
  var segments = [];
  var bucket = -1;
  var acc = newChroma();
  var frames = 0;
  var voiced = 0;
  function flush() {
    if (bucket < 0) return;
    var chord = voiced * 2 >= frames ? classifyChroma(acc) : 'N';
    segments.push({ time: bucket * WINDOW_SECONDS, chord: chord });
  }
  for (var start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    var b = Math.floor((start + FRAME_SIZE / 2) / SR / WINDOW_SECONDS);
    if (b !== bucket) {
      flush();
      bucket = b;
      acc = newChroma();
      frames = 0;
      voiced = 0;
    }
    frames++;
    var frame = core.arrayToVector(signal.subarray(start, start + FRAME_SIZE));
    var windowed = core.Windowing(frame, true, FRAME_SIZE, 'blackmanharris62').frame;
    var spectrum = core.Spectrum(windowed, FRAME_SIZE).spectrum;
    var peakFloor = spectrumMax(core.vectorToArray(spectrum)) * PEAK_FLOOR;
    if (peakFloor > SILENCE) {
      var peaks = core.SpectralPeaks(spectrum, peakFloor, 5000, 60, 40, 'frequency', SR);
      var hpcp = core.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
      var chroma = core.vectorToArray(hpcp);
      for (var j = 0; j < 12; j++) acc[j] += chroma[j] || 0;
      voiced++;
      peaks.frequencies.delete();
      peaks.magnitudes.delete();
      hpcp.delete();
    }
    frame.delete();
    windowed.delete();
    spectrum.delete();
  }
  flush();
  return compactChordTimeline(segments);
}

self.onmessage = function (event) {
  var data = event.data || {};
  try {
    if (!essentia) {
      // The WASM UMD ends with `exports.EssentiaWASM = Module`; a worker has
      // no `exports`, so give it one to write into.
      self.exports = self.exports || {};
      importScripts(data.wasmUrl, data.coreUrl);
      essentia = new self.Essentia(self.exports.EssentiaWASM);
    }
    self.postMessage({ id: data.id, ok: true, chords: extractChords(essentia, data.signal) });
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
