/**
 * What a rejected `HTMLMediaElement.play()` actually means.
 *
 * The engine used to read every rejection as "the browser blocked autoplay",
 * show "Tap play to start this preview." and set `isPlaying` false. But
 * `play()` also rejects with `AbortError` whenever a later `load()`, `src`
 * change or `pause()` interrupts it — which the engine does itself when it
 * swaps a network stream for a cached blob before sound starts. So a normal
 * tap on Preview ended paused, behind a message asking for a tap that had
 * already happened, and the `pause()` that followed aborted the retry too.
 *
 *   - `AbortError`        superseded by a newer request; that request owns the
 *                         outcome. Ignore.
 *   - `NotAllowedError`   a real autoplay block (no user activation). Only a
 *                         tap fixes it, so say so.
 *   - anything else       the source can't play (`NotSupportedError`, …). The
 *                         element's own `error` event reports it; the rejection
 *                         only needs to stop the spinner.
 */
export type PlayRejection = 'ignore' | 'needs-gesture' | 'failed';

export function classifyPlayRejection(err: unknown): PlayRejection {
  const name = typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : '';
  if (name === 'AbortError') return 'ignore';
  if (name === 'NotAllowedError') return 'needs-gesture';
  return 'failed';
}

/**
 * Whether the element already holds `src`. `audio.src` is always absolute,
 * so comparing it with a relative URL (`/api/store/preview/…`) never matched
 * and every re-run reloaded — aborting the play() that had just started.
 * The attribute keeps what was assigned.
 */
export function holdsSource(el: Pick<HTMLMediaElement, 'getAttribute'>, src: string): boolean {
  return el.getAttribute('src') === src;
}
