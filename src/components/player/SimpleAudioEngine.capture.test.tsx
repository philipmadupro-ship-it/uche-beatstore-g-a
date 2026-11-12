// @vitest-environment jsdom
/**
 * The engine's Web Audio capture must never cost the listener playback or a
 * position: these cover the element swap, the CORS retry and StrictMode.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Track } from '@/lib/types';

vi.mock('@/lib/offline/audio-cache', () => ({ getOfflineSrc: async () => null }));
vi.mock('@/lib/audio/preview-cache', () => ({ getPreviewSrc: async () => null, peekPreviewSrc: () => null }));

const h = vi.hoisted(() => ({
  cls: 'same-origin' as string,
  captured: null as HTMLMediaElement | null,
  attachResult: true,
  attach: vi.fn(),
  disable: vi.fn(),
  ensure: vi.fn(),
  release: vi.fn(),
  markBad: vi.fn(),
  probe: vi.fn(),
}));
vi.mock('@/lib/visuals/analyser-hub', () => ({
  attachElement: (el: HTMLMediaElement) => { h.attach(el); if (h.attachResult) h.captured = el; return h.attachResult; },
  isCaptured: (el: HTMLMediaElement | null) => !!el && h.captured === el,
  sourceClass: () => h.cls,
  disableCapture: () => h.disable(),
  ensureRunning: (cb: () => void) => h.ensure(cb),
  installGestureUnlock: () => {},
  markOriginBad: (s: string) => h.markBad(s),
  probeCors: (s: string) => h.probe(s),
  releaseHubElement: (el: HTMLMediaElement) => { h.release(el); if (h.captured === el) h.captured = null; },
}));

import { SimpleAudioEngine } from './SimpleAudioEngine';
import { usePlayer } from '@/hooks/usePlayer';

const track = (id: string) =>
  ({ id, title: id, audio_url: `https://cdn.example/${id}.mp3`, duration_seconds: 60 }) as Track;

let play: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  load = vi.fn();
  Object.assign(HTMLMediaElement.prototype, { play, pause: vi.fn(), load });
  Object.assign(h, { cls: 'same-origin', captured: null, attachResult: true });
  [h.attach, h.disable, h.ensure, h.release, h.markBad, h.probe].forEach((f) => f.mockReset());
  usePlayer.setState({
    currentTrack: null, queue: [], history: [], isPlaying: false,
    isBuffering: false, playbackError: null, progress: 0,
    volume: 0.5, muted: false, duckGain: 1, seekTarget: null,
  });
});
afterEach(cleanup);

const audio = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement;
function loadMetadata(a: HTMLAudioElement, seconds: number) {
  Object.defineProperty(a, 'duration', { configurable: true, get: () => seconds });
  act(() => { a.dispatchEvent(new Event('loadedmetadata')); });
}
const fire = (a: HTMLAudioElement, type: string) => act(() => { a.dispatchEvent(new Event(type)); });

describe('capture', () => {
  it('StrictMode does not capture twice', () => {
    const { container } = render(<StrictMode><SimpleAudioEngine /></StrictMode>);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    fire(audio(container), 'playing');
    fire(audio(container), 'playing');
    expect(h.attach).toHaveBeenCalledTimes(1);
  });

  it('does not capture a source that is not proven safe', () => {
    h.cls = 'unknown';
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    fire(audio(container), 'playing');
    expect(h.attach).not.toHaveBeenCalled();
    expect(h.probe).toHaveBeenCalled();
    expect(audio(container).hasAttribute('crossorigin')).toBe(false);
  });

  it('a CORS-proven source gets crossOrigin BEFORE src', () => {
    h.cls = 'cors-ok';
    const order: string[] = [];
    const proto = HTMLMediaElement.prototype;
    const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src')!;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() { return srcDesc.get!.call(this); },
      set(v) { order.push(`src:${(this as HTMLAudioElement).getAttribute('crossorigin')}`); srcDesc.set!.call(this, v); },
    });
    try {
      render(<SimpleAudioEngine />);
      act(() => { usePlayer.getState().setTrack(track('a')); });
    } finally { Object.defineProperty(proto, 'src', srcDesc); }
    expect(order[0]).toBe('src:anonymous');
  });
});

describe('CORS error retry', () => {
  it('retries the same source on a plain element, and marks the origin bad only once that plays', () => {
    h.cls = 'cors-ok';
    h.attachResult = false; // never captured
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    const a = audio(container);
    expect(a.getAttribute('crossorigin')).toBe('anonymous');
    const loads = load.mock.calls.length;

    fire(a, 'error');
    expect(a.hasAttribute('crossorigin')).toBe(false);
    expect(a.getAttribute('src')).toContain('a.mp3');
    expect(load.mock.calls.length).toBe(loads + 1);
    expect(h.markBad).not.toHaveBeenCalled(); // an error alone proves nothing
    expect(usePlayer.getState().playbackError).toBeNull();
    expect(usePlayer.getState().isPlaying).toBe(true);

    fire(a, 'canplay');
    expect(h.markBad).toHaveBeenCalledWith(expect.stringContaining('a.mp3'));
  });

  it('a second failure on the plain element is an ordinary error, origin untouched', () => {
    h.cls = 'cors-ok';
    h.attachResult = false;
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    fire(audio(container), 'error'); // CORS-mode failure -> retry
    fire(audio(container), 'error'); // plain failure too
    expect(h.markBad).not.toHaveBeenCalled();
    expect(usePlayer.getState().playbackError).toMatch(/unavailable/i);
    expect(usePlayer.getState().isPlaying).toBe(false);
  });
});

describe('element swap', () => {
  it('a captured CORS element that errors is replaced; position, volume and play state survive', () => {
    h.cls = 'cors-ok';
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    const first = audio(container);
    fire(first, 'playing'); // captured
    act(() => { usePlayer.getState().setProgress(0.4); });
    const plays = play.mock.calls.length;

    fire(first, 'error');
    const second = audio(container);
    expect(second).not.toBe(first);
    expect(h.release).toHaveBeenCalledWith(first);
    expect(h.disable).toHaveBeenCalled();
    expect(second.hasAttribute('crossorigin')).toBe(false); // plain retry
    expect(second.volume).toBeCloseTo(0.5);
    loadMetadata(second, 100);
    expect(second.currentTime).toBeCloseTo(40);
    expect(usePlayer.getState().isPlaying).toBe(true);
    expect(play.mock.calls.length).toBeGreaterThan(plays);
  });

  it('a stuck context after capture pauses with a message instead of a play() outside a gesture', () => {
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    const first = audio(container);
    fire(first, 'playing'); // captured
    h.ensure.mockImplementation((cb: () => void) => cb());
    act(() => { usePlayer.getState().setProgress(0.5); });
    const plays = play.mock.calls.length;
    fire(first, 'playing'); // ensureRunning -> broken

    expect(audio(container)).not.toBe(first);
    expect(usePlayer.getState()).toMatchObject({ isPlaying: false });
    expect(usePlayer.getState().playbackError).toMatch(/tap play/i);
    expect(play.mock.calls.length).toBe(plays); // no silent autoplay attempt
    loadMetadata(audio(container), 80);
    expect(audio(container).currentTime).toBeCloseTo(40); // position kept
  });

  it('a track change to an uncapturable source starts the NEW track at 0, not at the old progress', () => {
    const { container } = render(<SimpleAudioEngine />);
    act(() => { usePlayer.getState().setTrack(track('a')); });
    const first = audio(container);
    fire(first, 'playing'); // captured
    expect(h.captured).toBe(first);
    h.cls = 'unknown';
    act(() => {
      usePlayer.getState().setTrack(track('b'));
      usePlayer.setState({ progress: 0.6 }); // stale progress of track a
    });
    const second = audio(container);
    expect(second).not.toBe(first);
    expect(h.disable).toHaveBeenCalled();
    expect(second.getAttribute('src')).toContain('b.mp3');
    loadMetadata(second, 60);
    expect(second.currentTime).toBe(0);
  });
});
