/**
 * The control size scale for top-of-page chrome (UI-01).
 *
 * Before this the same job — "a button in a header" — came in nine heights
 * (22–42px) and four label sizes (9/10/11/13px). Two label sizes and three
 * heights are enough:
 *
 * - `md`   primary page actions and the top-bar hubs, search and session.
 * - `sm`   secondary actions: hero transport, tabs, chips.
 * - `icon` icon-only controls (bell, store, settings, account).
 *
 * Sizing only: radius, colour and state treatment stay with each component
 * (design-direction.md "Control language"). On a touch pointer the visual may
 * grow, and an invisible `::before` (`.ctl-tap`, globals.css) pads the hit
 * area out to {@link TAP_TARGET}px — shrink the visual, not the tap target.
 */

/** The touch target every control must reach (design-direction.md says ≥ 40, 44 preferred). */
export const TAP_TARGET = 44;

export type ControlSize = 'md' | 'sm' | 'icon';

export interface ControlSpec {
  /** Visual height with a mouse, px. */
  height: number;
  /** Visual height on a coarse (touch) pointer, px. */
  coarseHeight: number;
  /** Label size, px — must be a step on the type scale (10 mono labels, 11 body). */
  fontPx: 10 | 11;
  /** Icon size, px. */
  iconPx: number;
}

export const CONTROL_SPECS: Record<ControlSize, ControlSpec> = {
  md: { height: 36, coarseHeight: 36, fontPx: 11, iconPx: 14 },
  sm: { height: 28, coarseHeight: 32, fontPx: 10, iconPx: 12 },
  icon: { height: 32, coarseHeight: 40, fontPx: 11, iconPx: 16 },
};

/** How far the hit area extends past the visual on each side, px (never negative). */
export function tapExtension(visualPx: number, target: number = TAP_TARGET): number {
  return Math.max(0, Math.ceil((target - visualPx) / 2));
}

/**
 * The smallest gap between two neighbours for their padded hit areas not to
 * overlap: each extends into the gap by `ext`, so the gap must hold both.
 */
export function minGapForTap(ext: number): number {
  return ext * 2;
}

/** Hit-area extension on a touch pointer for this size, px. */
export function coarseTapExtension(size: ControlSize): number {
  return tapExtension(CONTROL_SPECS[size].coarseHeight);
}

/**
 * Tailwind classes per size. Literal strings (never built from the spec at
 * runtime) so Tailwind sees them; `control-size.test.ts` holds them equal to
 * CONTROL_SPECS. `[--tap-y]` is the hit-area padding `.ctl-tap` reads.
 */
export const CONTROL_CLASSES: Record<ControlSize, string> = {
  md: 'ctl-tap [--tap-y:4px] h-9 px-3 text-[11px]',
  sm: 'ctl-tap [--tap-y:6px] h-7 pointer-coarse:h-8 px-2.5 sm:px-3 text-[10px]',
  icon: 'ctl-tap [--tap-y:2px] size-8 pointer-coarse:size-10',
};
