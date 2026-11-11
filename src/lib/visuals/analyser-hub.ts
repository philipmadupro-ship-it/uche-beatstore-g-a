'use client';

/**
 * ONE AudioContext + analyser for the whole page, fed from the ONE player
 * <audio> element (SimpleAudioEngine). Visual components only READ from here.
 *
 * Safety rules (see lib/visuals/analysable.ts): the engine may only `attach`
 * an element whose current source is capturable. If capture later breaks
 * (context will not run, or a non-CORS source is about to load) the hub reports
 * it via `onBroken` so the engine can swap in a fresh, uncaptured element —
 * a captured element cannot be released, and a captured element playing a
 * non-CORS cross-origin source is silent.
 */

import { BAND_COUNT, isFlat, logBands } from './geometry';
import { classifySource, type CorsKnowledge } from './analysable';

const FFT_SIZE = 2048;

interface Hub {
  ctx: AudioContext;
  analyser: AnalyserNode;
  left: AnalyserNode;
  right: AnalyserNode;
  element: HTMLMediaElement;
  freq: Uint8Array<ArrayBuffer>;
  time: Uint8Array<ArrayBuffer>;
  tl: Uint8Array<ArrayBuffer>;
  tr: Uint8Array<ArrayBuffer>;
}

let hub: Hub | null = null;
const captured = new WeakSet<HTMLMediaElement>();
const corsKnown = new Map<string, boolean>();
const probing = new Set<string>();
const listeners = new Set<() => void>();
let broken: (() => void) | null = null;

export const knownCors: CorsKnowledge = corsKnown;

function notify() { listeners.forEach((l) => l()); }

export function subscribeHub(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
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
  fetch(src, { method: 'GET', headers: { Range: 'bytes=0-0' }, mode: 'cors', credentials: 'omit', signal: ctl.signal })
    .then((r) => { corsKnown.set(origin, r.ok || r.status === 206); try { ctl.abort(); } catch { /* done */ } })
    .catch(() => { corsKnown.set(origin, false); })
    .finally(() => { clearTimeout(timer); probing.delete(origin); notify(); });
}

export function markOriginBad(src: string): void {
  try { corsKnown.set(new URL(src, window.location.href).origin, false); } catch { /* ignore */ }
}

export function sourceClass(src: string) {
  return classifySource(src, window.location.origin, corsKnown);
}

/**
 * Capture `el` into the shared graph. Call from a user-gesture-driven play.
 * Returns false (and captures nothing) if Web Audio is unavailable.
 */
export function attachElement(el: HTMLMediaElement, onBroken: () => void): boolean {
  if (typeof window === 'undefined') return false;
  broken = onBroken;
  if (hub && hub.element === el) { void resumeContext(); return true; }
  if (hub || captured.has(el)) return false; // one capture per page
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    const ctx = new Ctor();
    const src = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0; // smoothing is ours (lib/visuals/geometry.smoothDecay)
    const split = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = right.fftSize = 512;
    src.connect(ctx.destination); // audible path never depends on the analysers
    src.connect(analyser);
    src.connect(split);
    split.connect(left, 0);
    split.connect(right, 1);
    captured.add(el);
    hub = {
      ctx, analyser, left, right, element: el,
      freq: new Uint8Array(analyser.frequencyBinCount),
      time: new Uint8Array(analyser.fftSize),
      tl: new Uint8Array(left.fftSize),
      tr: new Uint8Array(right.fftSize),
    };
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && !el.paused) broken?.();
    });
    void resumeContext();
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Resume the shared context; if it will not run, playback would be silent. */
export async function resumeContext(): Promise<void> {
  if (!hub) return;
  const { ctx } = hub;
  if (ctx.state === 'running') return;
  try { await ctx.resume(); } catch { /* handled below */ }
  if ((ctx.state as AudioContextState) !== 'running' && hub && !hub.element.paused) broken?.();
}

export function isCaptured(el: HTMLMediaElement | null): boolean {
  return !!el && captured.has(el);
}

/** Forget the capture (the element is being replaced); the context is reused. */
export function releaseHubElement(el: HTMLMediaElement): void {
  if (hub && hub.element === el) { hub = null; notify(); }
}

/** True once a live analyser exists and its context is running. */
export function analyserLive(): boolean {
  return !!hub && hub.ctx.state === 'running';
}

export interface LiveFrame { silent: boolean; left: number; right: number }

/**
 * Fill `bands` (log-spaced, 0..1) from the live FFT. Returns false when there
 * is no live analyser. `silent` is true when the FFT is flat — the caller
 * treats a flat analyser during playback as "cannot analyse" and falls back.
 */
export function readBands(bands: Float32Array, frame: LiveFrame): boolean {
  if (!hub || hub.ctx.state !== 'running') return false;
  hub.analyser.getByteFrequencyData(hub.freq);
  logBands(hub.freq, bands, hub.ctx.sampleRate);
  frame.silent = isFlat(hub.freq);
  hub.left.getByteTimeDomainData(hub.tl);
  hub.right.getByteTimeDomainData(hub.tr);
  frame.left = peakOfBytes(hub.tl);
  frame.right = peakOfBytes(hub.tr);
  return true;
}

function peakOfBytes(b: Uint8Array): number {
  let p = 0;
  for (let i = 0; i < b.length; i += 1) { const v = Math.abs(b[i] - 128); if (v > p) p = v; }
  return p / 128;
}

export { BAND_COUNT };
