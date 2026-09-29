/**
 * Essentia tempo + key off the main thread — a CLASSIC worker script.
 *
 * Why plain JS and importScripts: this build's bundler copies a
 * `new URL('./x', import.meta.url)` target verbatim into /_next/static/media
 * rather than bundling it as a worker entry, so a TypeScript/ESM worker would
 * reach the browser as raw TypeScript. What IS reliable is that copy: the two
 * official essentia.js UMD builds are emitted the same way, from our own
 * origin, and handed in as `wasmUrl` / `coreUrl`. (The old worker fetched
 * essentia.js from jsDelivr, which the CSP does not list, then looked for a
 * global that file never defines.)
 *
 * The two tasks below MUST match `essentia-extract.ts#extractEssentiaFeatures`
 * and `chord-extract.ts#extractChords`. `essentia-worker.test.ts` runs this
 * file against the real package and fails if either copy ever disagrees.
 *
 * In:  { id, task: 'features' | 'chords', wasmUrl, coreUrl,
 *        signal: Float32Array (mono, 44.1 kHz) }   (task defaults to 'features')
 * Out: { id, ok: true, features } | { id, ok: true, chords } | { id, ok: false, error }
 */
var essentia = null;

function finite(n) {
  return typeof n === 'number' && isFinite(n) ? n : null;
}

function extract(core, signal) {
  var SR = 44100;
  var empty = { bpm: null, bpmConfidence: null, key: null, scale: null, keyStrength: null };
  if (signal.length < SR * 2) return empty;
  var win = Math.round(60 * SR);
  var start = 0;
  var end = signal.length;
  if (signal.length > win) {
    start = Math.floor((signal.length - win) / 2);
    end = start + win;
  }
  var vec = core.arrayToVector(signal.subarray(start, end));

  var rhythm = core.RhythmExtractor2013(vec);
  var rawBpm = finite(rhythm.bpm);
  var bpm = rawBpm != null && rawBpm >= 30 && rawBpm <= 300 ? Math.round(rawBpm * 10) / 10 : null;

  var keyData = core.KeyExtractor(vec);
  var scale = keyData.scale === 'major' || keyData.scale === 'minor' ? keyData.scale : null;
  var key = keyData.key && scale ? keyData.key : null;

  return {
    bpm: bpm,
    bpmConfidence: bpm != null ? finite(rhythm.confidence) : null,
    key: key,
    scale: key ? scale : null,
    keyStrength: key ? finite(keyData.strength) : null,
  };
}

// ---- chords: copy of chord-extract.ts ------------------------------------

var FRAME = 4096;
var HOP = 2048;
var BUCKET_SECONDS = 1;
var MIN_SCORE = 0.45;
var PC = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

function chordTemplates() {
  var out = [];
  for (var root = 0; root < 12; root++) {
    var maj = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    maj[root] = 1; maj[(root + 4) % 12] = 1; maj[(root + 7) % 12] = 1;
    out.push({ label: PC[root], v: maj });
    var min = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    min[root] = 1; min[(root + 3) % 12] = 1; min[(root + 7) % 12] = 1;
    out.push({ label: PC[root] + 'm', v: min });
  }
  return out;
}

function classifyChroma(chroma, templates) {
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += chroma[i] || 0;
  if (sum < 1e-6) return 'N';
  var best = 'N';
  var bestScore = -1;
  for (var t = 0; t < templates.length; t++) {
    var dot = 0;
    for (var j = 0; j < 12; j++) dot += ((chroma[j] || 0) / sum) * templates[t].v[j];
    if (dot > bestScore) { bestScore = dot; best = templates[t].label; }
  }
  return bestScore < MIN_SCORE ? 'N' : best;
}

function segmentChords(frames) {
  var templates = chordTemplates();
  var segments = [];
  var bucket = -1;
  var bucketTime = 0;
  var acc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  function flush() {
    if (bucket >= 0) segments.push({ time: +bucketTime.toFixed(2), chord: classifyChroma(acc, templates) });
  }
  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    var b = Math.floor(f.time / BUCKET_SECONDS);
    if (b !== bucket) {
      flush();
      bucket = b;
      bucketTime = f.time;
      acc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    for (var j = 0; j < 12; j++) acc[j] += f.chroma[j] || 0;
  }
  flush();
  var merged = [];
  for (var k = 0; k < segments.length; k++) {
    if (merged.length && merged[merged.length - 1].chord === segments[k].chord) continue;
    merged.push(segments[k]);
  }
  while (merged.length && merged[0].chord === 'N') merged.shift();
  while (merged.length && merged[merged.length - 1].chord === 'N') merged.pop();
  return merged;
}

function extractChords(core, signal) {
  var SR = 44100;
  var perFrame = [];
  // Framed here, not with FrameGenerator: that drops silent frames and
  // shifts every chord after a break early (see chord-extract.ts).
  for (var start = 0; start + FRAME <= signal.length; start += HOP) {
    var frame = core.arrayToVector(signal.subarray(start, start + FRAME));
    var windowed = core.Windowing(frame, true, FRAME, 'hann').frame;
    var spectrum = core.Spectrum(windowed).spectrum;
    var peaks = core.SpectralPeaks(spectrum, 0, 5000, 100, 0, 'frequency', SR);
    var hpcp = core.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
    perFrame.push({ time: start / SR, chroma: core.vectorToArray(hpcp) });
  }
  return segmentChords(perFrame);
}

// ---- dispatch ----------------------------------------------------------------

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
    if (data.task === 'chords') {
      self.postMessage({ id: data.id, ok: true, chords: extractChords(essentia, data.signal) });
    } else {
      self.postMessage({ id: data.id, ok: true, features: extract(essentia, data.signal) });
    }
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
