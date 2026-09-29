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
 * The extraction below MUST match `essentia-extract.ts#extractEssentiaFeatures`.
 * `essentia-worker.test.ts` runs this file against the real package and fails
 * if the two ever disagree.
 *
 * In:  { id, wasmUrl, coreUrl, signal: Float32Array (mono, 44.1 kHz) }
 * Out: { id, ok: true, features } | { id, ok: false, error }
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
    self.postMessage({ id: data.id, ok: true, features: extract(essentia, data.signal) });
  } catch (err) {
    self.postMessage({ id: data.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
