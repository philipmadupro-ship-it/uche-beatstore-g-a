// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetHubForTests, attachElement, ensureRunning, installGestureUnlock, isCaptured, isCaptureDisabled,
  releaseHubElement,
} from './analyser-hub';

let created = 0;
let sources = 0;
let state: AudioContextState = 'suspended';
let resumeImpl: () => Promise<void>;

class FakeNode { connect() {} disconnect() {} fftSize = 0; frequencyBinCount = 8; smoothingTimeConstant = 0; getByteFrequencyData() {} getByteTimeDomainData() {} }
class FakeCtx {
  destination = new FakeNode();
  sampleRate = 44100;
  constructor() { created += 1; }
  get state() { return state; }
  createAnalyser() { return new FakeNode(); }
  createChannelSplitter() { return new FakeNode(); }
  createMediaElementSource() { sources += 1; return new FakeNode(); }
  resume() { return resumeImpl(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  created = 0; sources = 0; state = 'suspended';
  resumeImpl = () => { state = 'running'; return Promise.resolve(); };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  __resetHubForTests();
});
afterEach(() => { vi.useRealTimers(); });

const el = () => document.createElement('audio');
const gesture = () => document.dispatchEvent(new Event('pointerdown'));

describe('analyser hub safety', () => {
  it('creates no context and captures nothing until a user gesture', () => {
    installGestureUnlock();
    expect(created).toBe(0);
    expect(attachElement(el())).toBe(false);
    expect(sources).toBe(0);
  });

  it('a gesture creates ONE context and resumes it; capture then works', async () => {
    installGestureUnlock();
    gesture(); await Promise.resolve(); await Promise.resolve();
    gesture();
    expect(created).toBe(1);
    const a = el();
    expect(attachElement(a)).toBe(true);
    expect(isCaptured(a)).toBe(true);
    expect(sources).toBe(1);
  });

  it('a context that stays suspended is never captured into (that would silence playback)', () => {
    resumeImpl = () => new Promise(() => {}); // iOS: resume() pending forever
    installGestureUnlock();
    gesture();
    const a = el();
    expect(attachElement(a)).toBe(false);
    expect(isCaptured(a)).toBe(false);
    expect(sources).toBe(0);
  });

  it('is idempotent for one element and refuses a second concurrent capture', async () => {
    installGestureUnlock();
    gesture(); await Promise.resolve(); await Promise.resolve();
    const a = el(); const b = el();
    expect(attachElement(a)).toBe(true);
    expect(attachElement(a)).toBe(true);
    expect(sources).toBe(1);
    expect(attachElement(b)).toBe(false);
  });

  it('release detaches the source but keeps the one context; no new context is made', async () => {
    installGestureUnlock();
    gesture(); await Promise.resolve(); await Promise.resolve();
    const a = el();
    attachElement(a);
    releaseHubElement(a);
    expect(isCaptured(a)).toBe(false);
    const b = el();
    expect(attachElement(b)).toBe(true);
    expect(created).toBe(1);
  });

  it('a context that stops running after capture disables capture for good and reports broken', async () => {
    vi.useFakeTimers();
    installGestureUnlock();
    gesture(); await Promise.resolve(); await Promise.resolve();
    attachElement(el());
    state = 'suspended';
    resumeImpl = () => new Promise(() => {});
    const broken = vi.fn();
    ensureRunning(broken);
    vi.advanceTimersByTime(1300);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(isCaptureDisabled()).toBe(true);
    expect(attachElement(el())).toBe(false);
  });
});
