// @vitest-environment jsdom

/**
 * Lifecycle tests for the ASCII cover art render loop.
 *
 * WHY THIS FILE EXISTS. Every bug this component shipped was a *lifecycle*
 * bug, not a maths bug — and the project's "extract pure logic to lib/ and
 * Vitest it" rule cannot catch any of them:
 *
 *   1. A leftover `requestAnimationFrame(draw)` inside the draw body scheduled
 *      a second frame on top of the loop's own scheduling, so pending
 *      callbacks doubled every frame until the main thread starved and the
 *      canvas never painted at all.
 *   2. The cover was fetched from the raw R2 URL with `crossOrigin`, which the
 *      public bucket has no CORS headers for, so the load failed silently
 *      forever and nothing was ever drawn.
 *   3. `if (!resize()) return;` gave up permanently when the canvas measured
 *      zero on first run (a Drawer mid-open-transition does exactly that),
 *      never creating the ResizeObserver that would have recovered.
 *   4. An empty dependency array meant changing track kept rendering the
 *      PREVIOUS track's cover.
 *
 * Each is pinned below. Canvas, ResizeObserver, matchMedia, Image and rAF are
 * all stubbed because jsdom implements none of them usefully — the point is to
 * assert *scheduling and wiring*, not pixels.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { AsciiCoverArt } from './AsciiCoverArt';

/* ── rAF harness: a controllable frame queue ─────────────────────────── */

let frameQueue = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

/** Number of frames currently scheduled. The duplicate-scheduling canary. */
const pendingFrames = () => frameQueue.size;

/** Run every currently-queued callback once. */
function flushFrame() {
  const due = [...frameQueue.entries()];
  frameQueue = new Map();
  for (const [, cb] of due) cb(1000);
}

/* ── Canvas 2D stub that records what was asked of it ────────────────── */

interface FakeCtx {
  calls: string[];
  [k: string]: unknown;
}

function makeCtx(): FakeCtx {
  const calls: string[] = [];
  const noop = (name: string) => (...args: unknown[]) => { calls.push(`${name}(${args.length})`); };
  return {
    calls,
    setTransform: noop('setTransform'),
    clearRect: noop('clearRect'),
    fillRect: noop('fillRect'),
    fillText: noop('fillText'),
    drawImage: noop('drawImage'),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      calls.push('getImageData');
      return { data: new Uint8ClampedArray(Math.max(1, w * h) * 4) };
    },
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '',
    font: '',
    textBaseline: '',
    globalAlpha: 1,
  };
}

let lastMainCtx: FakeCtx | null = null;

/* ── Image stub so we can control load timing ────────────────────────── */

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 640;
  naturalHeight = 640;
  width = 640;
  height = 640;
  src = '';
  constructor() { FakeImage.instances.push(this); }
  /** Simulate the browser finishing the fetch. */
  finishLoad() { this.onload?.(); }
}

/* ── matchMedia stub with a controllable `matches` + listeners ────────── */

let reducedMotion = false;
const motionListeners = new Set<() => void>();
function setReducedMotion(v: boolean) {
  reducedMotion = v;
  for (const l of motionListeners) l();
}

let resizeObserverCount = 0;

beforeEach(() => {
  frameQueue = new Map();
  nextFrameId = 1;
  FakeImage.instances = [];
  lastMainCtx = null;
  reducedMotion = false;
  motionListeners.clear();
  resizeObserverCount = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frameQueue.delete(id); });
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('ResizeObserver', class {
    constructor(_cb: () => void) { resizeObserverCount++; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reducedMotion; },
    addEventListener: (_e: string, l: () => void) => { motionListeners.add(l); },
    removeEventListener: (_e: string, l: () => void) => { motionListeners.delete(l); },
  }));

  // Give the canvas a real size and a working 2D context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = makeCtx();
    // The main canvas is the one in the DOM; the offscreen buffer is detached.
    if (this.isConnected) lastMainCtx = ctx;
    return ctx as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 440, height: 260, top: 0, left: 0, right: 440, bottom: 260, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderArt = (props: Partial<React.ComponentProps<typeof AsciiCoverArt>> = {}) =>
  render(
    <AsciiCoverArt
      src="https://pub-xyz.r2.dev/covers/a.jpg"
      level={0.5}
      bass={0.5}
      playing
      {...props}
    />,
  );

describe('AsciiCoverArt render loop', () => {
  it('schedules exactly one frame at a time while playing', () => {
    // THE regression test. The bug doubled pending callbacks every frame;
    // this asserts the count stays flat no matter how long it runs.
    act(() => { renderArt(); });
    expect(pendingFrames()).toBe(1);

    for (let i = 0; i < 12; i++) {
      act(() => { flushFrame(); });
      expect(pendingFrames()).toBe(1);
    }
  });

  it('suspends instead of burning frames while paused', () => {
    act(() => { renderArt({ playing: false }); });
    // It draws once so the art is correct on screen...
    expect(pendingFrames()).toBe(1);
    act(() => { flushFrame(); });
    // ...then stops scheduling entirely.
    expect(pendingFrames()).toBe(0);
  });

  it('suspends under prefers-reduced-motion even while playing', () => {
    reducedMotion = true;
    act(() => { renderArt({ playing: true }); });
    act(() => { flushFrame(); });
    expect(pendingFrames()).toBe(0);
  });

  it('reacts to prefers-reduced-motion changing after mount', () => {
    // Previously `matches` was read once at effect setup, so toggling the OS
    // setting did nothing until the component remounted.
    act(() => { renderArt({ playing: true }); });
    act(() => { flushFrame(); });
    expect(pendingFrames()).toBe(1); // still animating

    act(() => { setReducedMotion(true); });
    act(() => { flushFrame(); });
    expect(pendingFrames()).toBe(0); // stopped
  });

  it('wakes the suspended loop when playback resumes', () => {
    const { rerender } = renderArt({ playing: false });
    act(() => { flushFrame(); });
    expect(pendingFrames()).toBe(0);

    act(() => {
      rerender(
        <AsciiCoverArt src="https://pub-xyz.r2.dev/covers/a.jpg" level={0.5} bass={0.5} playing />,
      );
    });
    expect(pendingFrames()).toBe(1);
  });

  it('stops scheduling after repeated frame failures rather than looping forever', () => {
    act(() => { renderArt(); });
    // Make every frame throw from inside the draw body.
    if (lastMainCtx) {
      lastMainCtx.setTransform = () => { throw new Error('boom'); };
    }
    for (let i = 0; i < 40 && pendingFrames() > 0; i++) {
      act(() => { flushFrame(); });
    }
    expect(pendingFrames()).toBe(0);
  });

  it('cancels its frame on unmount', () => {
    const { unmount } = renderArt();
    expect(pendingFrames()).toBe(1);
    act(() => { unmount(); });
    expect(pendingFrames()).toBe(0);
  });
});

describe('AsciiCoverArt image loading', () => {
  it('loads the cover same-origin through the image optimizer, not the raw R2 URL', () => {
    // The raw cross-origin URL silently fails: the public bucket sends no CORS
    // headers, so `imgReady` never flipped and nothing was ever drawn.
    act(() => { renderArt({ src: 'https://pub-xyz.r2.dev/covers/a.jpg' }); });
    const img = FakeImage.instances.at(-1)!;
    expect(img.src.startsWith('/_next/image?url=')).toBe(true);
    expect(img.src).toContain(encodeURIComponent('https://pub-xyz.r2.dev/covers/a.jpg'));
  });

  it('reloads the image when the track changes', () => {
    // An empty dependency array meant switching tracks kept the old cover.
    const { rerender } = renderArt({ src: 'https://pub-xyz.r2.dev/a.jpg' });
    const first = FakeImage.instances.length;

    act(() => {
      rerender(
        <AsciiCoverArt src="https://pub-xyz.r2.dev/b.jpg" level={0.5} bass={0.5} playing />,
      );
    });

    expect(FakeImage.instances.length).toBeGreaterThan(first);
    expect(FakeImage.instances.at(-1)!.src).toContain(encodeURIComponent('https://pub-xyz.r2.dev/b.jpg'));
  });

  it('wakes a suspended loop when the cover finishes loading', () => {
    // A cover that loads while paused must still get painted.
    act(() => { renderArt({ playing: false }); });
    act(() => { flushFrame(); });
    expect(pendingFrames()).toBe(0);

    act(() => { FakeImage.instances.at(-1)!.finishLoad(); });
    expect(pendingFrames()).toBe(1);
  });
});

describe('AsciiCoverArt sizing', () => {
  it('always creates a ResizeObserver, even when it first measures zero', () => {
    // The old `if (!resize()) return;` skipped observer creation entirely when
    // the parent Drawer was still animating open, blanking the canvas for good.
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => { renderArt(); });
    expect(resizeObserverCount).toBeGreaterThan(0);
  });

  it('does not throw when drawing at zero size', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(() => {
      act(() => { renderArt(); });
      act(() => { flushFrame(); });
    }).not.toThrow();
  });
});
