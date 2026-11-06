import { describe, expect, it } from 'vitest';
import { fitPanelTop } from './popover-position';

const view = 900;

describe('fitPanelTop', () => {
  it('keeps the panel under its trigger when it fits', () => {
    expect(fitPanelTop({ triggerTop: 100, triggerBottom: 130, panelHeight: 300, viewportHeight: view })).toBe(136);
  });

  it('flips above the trigger when it does not fit below but fits above', () => {
    expect(fitPanelTop({ triggerTop: 800, triggerBottom: 830, panelHeight: 500, viewportHeight: view })).toBe(800 - 6 - 500);
  });

  it('slides up to the bottom margin when it fits neither side, so the whole panel is on screen', () => {
    // 700 tall panel, trigger in the middle: below has 400, above has 400.
    expect(fitPanelTop({ triggerTop: 440, triggerBottom: 470, panelHeight: 700, viewportHeight: view })).toBe(view - 8 - 700);
  });

  it('never starts above the top margin, even for a panel taller than the viewport', () => {
    expect(fitPanelTop({ triggerTop: 440, triggerBottom: 470, panelHeight: 2000, viewportHeight: view })).toBe(8);
  });

  it('a trigger scrolled off the TOP still yields a panel that starts on screen', () => {
    expect(fitPanelTop({ triggerTop: -230, triggerBottom: -200, panelHeight: 300, viewportHeight: view })).toBe(8);
  });

  it('a trigger scrolled off the bottom of the viewport still yields an on-screen panel', () => {
    const top = fitPanelTop({ triggerTop: 1500, triggerBottom: 1530, panelHeight: 300, viewportHeight: view });
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 300).toBeLessThanOrEqual(view - 8);
  });
});
