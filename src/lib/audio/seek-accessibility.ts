export type SeekKeyboardKey = 'ArrowLeft' | 'ArrowRight' | 'PageDown' | 'PageUp' | 'Home' | 'End';

const STEP_SECONDS = 5;
const PAGE_STEP_SECONDS = 30;

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function keyboardSeekFraction(
  key: string,
  progress: number,
  durationSeconds: number | null | undefined,
): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return 1;

  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const current = clampProgress(progress);
  const step = key === 'PageUp' || key === 'PageDown'
    ? PAGE_STEP_SECONDS / duration
    : STEP_SECONDS / duration;

  if (key === 'ArrowRight' || key === 'PageUp') return clampProgress(current + step);
  if (key === 'ArrowLeft' || key === 'PageDown') return clampProgress(current - step);

  return null;
}
