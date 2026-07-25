/**
 * Web Audio engine for the Studio (FL-Lite).
 *
 * Architecture:
 *
 *   Channel(audio element)
 *     ├ MediaElementSource → input
 *     │   → eqLow (low-shelf) → eqMid (peaking) → eqHigh (high-shelf)
 *     │   → pan (StereoPanner) → gain (Gain)
 *     │       ├── (dry) → masterIn
 *     │       ├── reverbSend → reverbBus
 *     │       └── delaySend  → delayBus
 *
 *   Pad (drum pads) → padBus → masterIn (pre-effects on the pad bus only)
 *
 *   reverbBus → ConvolverNode → reverbReturn → masterIn
 *   delayBus  → DelayNode (with feedback) → delayReturn → masterIn
 *
 *   masterIn → compressor → masterGain
 *     → AudioContext.destination
 *     → MediaStreamDestination (capture for recording)
 *
 * Channels are created on demand (one per stem) and torn down on unload.
 */

export type ChannelKey = 'master' | 'vocals' | 'drums' | 'bass' | 'other' | 'pads';

export interface ChannelNodes {
  source: MediaElementAudioSourceNode | null;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  pan: StereoPannerNode;
  gain: GainNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  analyser: AnalyserNode;
  el?: HTMLAudioElement;
}

export interface EngineOptions {
  reverbSeconds?: number;
  reverbDecay?: number;
}

type AudioContextWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function makeImpulse(ctx: AudioContext, seconds = 2.4, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      // Decaying noise burst
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export class StudioEngine {
  ctx: AudioContext;
  masterIn: GainNode;
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  destination: AudioDestinationNode;
  recordDest: MediaStreamAudioDestinationNode;

  reverbBus: GainNode;
  reverbConvolver: ConvolverNode;
  reverbReturn: GainNode;

  delayBus: GainNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayReturn: GainNode;

  channels = new Map<string, ChannelNodes>();
  masterAnalyser: AnalyserNode;

  constructor(opts: EngineOptions = {}) {
    const audioWindow = window as AudioContextWindow;
    const Ctx = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API is not available');
    this.ctx = new Ctx();

    this.masterIn = this.ctx.createGain();
    this.masterIn.gain.value = 1;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;

    this.destination = this.ctx.destination;
    this.recordDest = this.ctx.createMediaStreamDestination();

    // Master chain
    this.masterIn.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterGain.connect(this.destination);
    this.masterGain.connect(this.recordDest);

    // Reverb bus
    this.reverbBus = this.ctx.createGain();
    this.reverbBus.gain.value = 1;
    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbConvolver.buffer = makeImpulse(this.ctx, opts.reverbSeconds ?? 2.4, opts.reverbDecay ?? 2.6);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = 0.7;
    this.reverbBus.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterIn);

    // Delay bus (with feedback)
    this.delayBus = this.ctx.createGain();
    this.delayBus.gain.value = 1;
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.375; // dotted 8th-ish at ~120 bpm
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayReturn = this.ctx.createGain();
    this.delayReturn.gain.value = 0.6;
    this.delayBus.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayReturn);
    this.delayReturn.connect(this.masterIn);
  }

  resume() {
    if (this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  /** Build a channel from an existing <audio> element. */
  attachChannel(key: string, el: HTMLAudioElement): ChannelNodes {
    this.detachChannel(key);

    let source: MediaElementAudioSourceNode | null = null;
    try {
      source = this.ctx.createMediaElementSource(el);
    } catch (err) {
      // The same element can only be used as a source once — if it's already
      // wired we silently skip and treat the channel as headless.
      console.warn(`[engine] could not attach source for ${key}:`, err);
    }

    const eqLow = this.ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 250;
    eqLow.gain.value = 0;

    const eqMid = this.ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 0.7;
    eqMid.gain.value = 0;

    const eqHigh = this.ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4500;
    eqHigh.gain.value = 0;

    const pan = this.ctx.createStereoPanner();
    pan.pan.value = 0;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.85;

    const reverbSend = this.ctx.createGain();
    reverbSend.gain.value = 0;

    const delaySend = this.ctx.createGain();
    delaySend.gain.value = 0;

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;

    if (source) {
      source.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(pan);
      pan.connect(gain);
    }
    gain.connect(this.masterIn);
    gain.connect(reverbSend);
    reverbSend.connect(this.reverbBus);
    gain.connect(delaySend);
    delaySend.connect(this.delayBus);
    gain.connect(analyser);

    const node: ChannelNodes = {
      source,
      eqLow,
      eqMid,
      eqHigh,
      pan,
      gain,
      reverbSend,
      delaySend,
      analyser,
      el,
    };
    this.channels.set(key, node);
    return node;
  }

  /** Build a "headless" channel (e.g. for the drum pad bus). */
  attachBus(key: string): ChannelNodes {
    this.detachChannel(key);
    const eqLow = this.ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 250;
    eqLow.gain.value = 0;
    const eqMid = this.ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 0.7;
    eqMid.gain.value = 0;
    const eqHigh = this.ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4500;
    eqHigh.gain.value = 0;
    const pan = this.ctx.createStereoPanner();
    const gain = this.ctx.createGain();
    gain.gain.value = 0.85;
    const reverbSend = this.ctx.createGain();
    reverbSend.gain.value = 0;
    const delaySend = this.ctx.createGain();
    delaySend.gain.value = 0;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;

    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(pan);
    pan.connect(gain);
    gain.connect(this.masterIn);
    gain.connect(reverbSend);
    reverbSend.connect(this.reverbBus);
    gain.connect(delaySend);
    delaySend.connect(this.delayBus);
    gain.connect(analyser);

    const node: ChannelNodes = {
      source: null,
      eqLow,
      eqMid,
      eqHigh,
      pan,
      gain,
      reverbSend,
      delaySend,
      analyser,
    };
    this.channels.set(key, node);
    return node;
  }

  detachChannel(key: string) {
    const node = this.channels.get(key);
    if (!node) return;
    try {
      node.source?.disconnect();
      node.eqLow.disconnect();
      node.eqMid.disconnect();
      node.eqHigh.disconnect();
      node.pan.disconnect();
      node.gain.disconnect();
      node.reverbSend.disconnect();
      node.delaySend.disconnect();
      node.analyser.disconnect();
    } catch {}
    this.channels.delete(key);
  }

  destroy() {
    for (const k of Array.from(this.channels.keys())) this.detachChannel(k);
    try {
      this.ctx.close();
    } catch {}
  }
}

// ───────── Drum-pad synth voices ─────────

export function playKick(ctx: AudioContext, dest: AudioNode, when = ctx.currentTime) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(40, when + 0.18);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(1, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
  osc.connect(gain).connect(dest);
  osc.start(when);
  osc.stop(when + 0.55);
}

export function playSnare(ctx: AudioContext, dest: AudioNode, when = ctx.currentTime) {
  // Tone
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, when);
  oscGain.gain.setValueAtTime(0.0001, when);
  oscGain.gain.exponentialRampToValueAtTime(0.6, when + 0.005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  osc.connect(oscGain).connect(dest);
  osc.start(when);
  osc.stop(when + 0.2);
  // Noise
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1500;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, when);
  noiseGain.gain.exponentialRampToValueAtTime(0.7, when + 0.005);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  src.connect(noiseFilter).connect(noiseGain).connect(dest);
  src.start(when);
  src.stop(when + 0.25);
}

export function playHat(ctx: AudioContext, dest: AudioNode, when = ctx.currentTime, open = false) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 10000;
  const g = ctx.createGain();
  const tail = open ? 0.22 : 0.05;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + tail);
  src.connect(hp).connect(bp).connect(g).connect(dest);
  src.start(when);
  src.stop(when + tail + 0.05);
}

export function playClap(ctx: AudioContext, dest: AudioNode, when = ctx.currentTime) {
  // Three quick bursts of filtered noise
  const offsets = [0, 0.012, 0.024];
  for (const off of offsets) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const t = when + off;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.18);
  }
}
