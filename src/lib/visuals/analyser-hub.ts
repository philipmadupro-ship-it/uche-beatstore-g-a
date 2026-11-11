'use client';

/**
 * ONE AudioContext + analyser graph for the whole page, fed from the ONE player
 * <audio> element (SimpleAudioEngine). Visual components only READ from here.
 *
 * Safety rules — playback must never depend on the visual:
 *  - The context is created and `resume()`d inside a USER GESTURE (a one-time
 *    capture-phase unlock on the document). iOS/Safari start contexts
 *    suspended and only let a gesture lift that.
 *  - An element is captured ONLY when the context is already `running` and its
 *    source is capturable (lib/visuals/analysable). A captured element routes
 *    all its audio through the context, so capturing into a suspended one
 *    would make playback silent.
 *  - ONE context per page, never recreated. Releasing an element only
 *    disconnects its source node. The context is closed on page teardown.
 *  - If capture ever has to be abandoned (the context will not run, a source
 *    that cannot be captured follows, createMediaElementSource throws) a
 *    session-wide `captureDisabled` flag is set and nothing is captured again:
 *    visuals fall back to the track's peaks. No retry loops.
 */

import { BAND_COUNT, isFlat, logBands } from './geometry';
import { classifySource, type CorsKnowledge } from './analysable';

const FFT_SIZE = 2048;
const RUN_CHECK_MS = 1200;
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;

interface Graph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  split: ChannelSplitterNode;
  left: AnalyserNode;
  right: AnalyserNode;
  freq: Uint8Array<ArrayBuffer>;
  tl: Uint8Array<ArrayBuffer>;
  tr: Uint8Array<ArrayBuffer>;
}

let graph: Graph | null = null;
let source: { el: HTMLMediaElement; node: MediaElementAudioSourceNode } | null = null;
const everCaptured = new WeakSet<HTMLMediaElement>();
let captureDisabled = false;
let unlockInstalled = false;
let runTimer: ReturnType<typeof setTimeout> | null = null;

const corsKnown = new Map<string, boolean>();
const probing = new Set<string>();
export const knownCors: CorsKnowledge = corsKnown;

export function isCaptureDisabled(): boolean { return captureDisabled; }

/** Give up on capturing for the rest of this page's life. */
export function disableCapture(): void { captureDisabled = true; }

function ensureGraph(): Graph | null {
  if (graph) return graph;
  if (typeof window === 'undefined' || captureDisabled) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0; // smoothing is ours (geometry.smoothDecay)
    const split = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = right.fftSize = 512;
    split.connect(left, 0);
    split.connect(right, 1);
    graph = {
      ctx, analyser, split, left, right,
      freq: new Uint8Array(analyser.frequencyBinCount),
      tl: new Uint8Array(left.fftSize),
      tr: new Uint8Array(right.fftSize),
    };
    // Page teardown: release the audio device.
    window.addEventListener('pagehide', () => { void ctx.close().catch(() => {}); }, { once: true });
    return graph;
  } catch {
    captureDisabled = true;
    return null;
  }
}

/**
 * Install the one-time gesture unlock. The first pointer/key/touch anywhere
 * creates the context and resumes it (the only moment iOS allows it); the
 * listeners come off once it is running.
 */
export function installGestureUnlock(): void {
  if (typeof document === 'undefined' || unlockInstalled || captureDisabled) return;
  unlockInstalled = true;
  const remove = () => UNLOCK_EVENTS.forEach((e) => document.removeEventListener(e, handler, true));
  const handler = () => {
    const g = ensureGraph();
    if (!g) { remove(); return; }
    if (g.ctx.state === 'running') { remove(); return; }
    g.ctx.resume().then(() => { if (g.ctx.state === 'running') remove(); }, () => { /* next gesture retries */ });
  };
  UNLOCK_EVENTS.forEach((e) => document.addEventListener(e, handler, true));
}

/** Background CORS probe for a cross-origin audio URL; never blocks playback. */
export function probeCors(src: string): void {
  if (typeof window === 'undefined') return;
  let origin: string;
  try { origin = new URL(src, window.location.href).origin; } catch { return; }
  if (origin === window.location.origin || corsKnown.has(origin) || probing.has(origin)) return;
  probing.add(origin);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  // HEAD: a CORS-safelisted method, so no preflight and never a body. A missing
  // Access-Control-Allow-Origin makes fetch reject, which is exactly the answer.
  fetch(src, { method: 'HEAD', mode: 'cors', credentials: 'omit', signal: ctl.signal })
    .then((r) => { corsKnown.set(origin, r.ok); })
    .catch(() => { corsKnown.set(origin, false); })
    .finally(() => { clearTimeout(timer); probing.delete(origin); });
}

export function markOriginBad(src: string): void {
  try { corsKnown.set(new URL(src, window.location.href).origin, false); } catch { /* ignore */ }
}

export function sourceClass(src: string) {
  return classifySource(src, window.location.origin, corsKnown);
}

/**
 * Capture `el` into the shared graph, only if that cannot silence it: the
 * context must already be running (gesture-unlocked) and capture not disabled.
 * Returns whether the element is now captured.
 */
export function attachElement(el: HTMLMediaElement): boolean {
  if (captureDisabled || typeof window === 'undefined') return false;
  if (source && source.el === el) return true;
  if (source || everCaptured.has(el)) return false; // one live capture at a time
  const g = graph;
  if (!g || g.ctx.state !== 'running') return false;
  try {
    const node = g.ctx.createMediaElementSource(el);
    node.connect(g.ctx.destination); // audible path never depends on the analysers
    node.connect(g.analyser);
    node.connect(g.split);
    everCaptured.add(el);
    source = { el, node };
    return true;
  } catch {
    captureDisabled = true;
    return false;
  }
}

/**
 * After capture the context must stay running or playback is silent (iOS can
 * suspend/interrupt it). Called from the play path: lift a suspension, and if
 * the context still is not running shortly after, abandon capture for good and
 * tell the engine so it can replace the element.
 */
export function ensureRunning(onBroken: () => void): void {
  const g = graph;
  if (!g || !source) return;
  if (g.ctx.state === 'running') return;
  void g.ctx.resume().catch(() => {});
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    runTimer = null;
    if (graph && source && graph.ctx.state !== 'running') {
      captureDisabled = true;
      onBroken();
    }
  }, RUN_CHECK_MS);
}

export function isCaptured(el: HTMLMediaElement | null): boolean {
  return !!el && !!source && source.el === el;
}

/** Detach the element's source node. The context and analysers stay. */
export function releaseHubElement(el: HTMLMediaElement): void {
  if (!source || source.el !== el) return;
  if (runTimer) { clearTimeout(runTimer); runTimer = null; }
  try { source.node.disconnect(); } catch { /* already gone */ }
  source = null;
}

/** True once a live analyser exists and its context is running. */
export function analyserLive(): boolean {
  return !!graph && !!source && graph.ctx.state === 'running';
}

export interface LiveFrame { silent: boolean; left: number; right: number }

/**
 * Fill `bands` (log-spaced, 0..1) from the live FFT. Returns false when there
 * is no live analyser. `silent` is true when the FFT is flat — the caller
 * treats a flat analyser during playback as "cannot analyse" and falls back.
 */
export function readBands(bands: Float32Array, frame: LiveFrame): boolean {
  const g = graph;
  if (!g || !source || g.ctx.state !== 'running') return false;
  g.analyser.getByteFrequencyData(g.freq);
  logBands(g.freq, bands, g.ctx.sampleRate);
  frame.silent = isFlat(g.freq);
  g.left.getByteTimeDomainData(g.tl);
  g.right.getByteTimeDomainData(g.tr);
  frame.left = peakOfBytes(g.tl);
  frame.right = peakOfBytes(g.tr);
  return true;
}

function peakOfBytes(b: Uint8Array): number {
  let p = 0;
  for (let i = 0; i < b.length; i += 1) { const v = Math.abs(b[i] - 128); if (v > p) p = v; }
  return p / 128;
}

/** Test seam: forget all module state. */
export function __resetHubForTests(): void {
  graph = null; source = null; captureDisabled = false; unlockInstalled = false;
  corsKnown.clear(); probing.clear();
  if (runTimer) { clearTimeout(runTimer); runTimer = null; }
}

export { BAND_COUNT };

// Listen from the moment this module loads: the engine mounts only once a track
// is chosen, which can be AFTER the very tap that starts playback.
installGestureUnlock();
