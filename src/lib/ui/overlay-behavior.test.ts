import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Guards that full-screen overlays give keyboard users a way out.
 *
 * A `fixed inset-0` scrim with a click handler is a dialog whether or not it
 * says so. Without Escape, a keyboard user who opens one can only leave by
 * tabbing to a close button they may not be able to see; without focus
 * restoration, closing it drops focus to `<body>` so the next Tab starts from
 * the top of the page. `hooks/useDialogBehavior` exists to give exactly that to
 * overlays not built on `ui/Modal`, in three lines and without touching markup.
 *
 * `ui/Modal`, `ui/Drawer` and `ui/Popover` already implement it themselves, so
 * anything rendering through them is fine and never reaches this scan.
 *
 * This is the drift the design doc's "modal consolidation" item is about. Most
 * of that work is already done — 27 components carry `role="dialog"` — so the
 * value now is stopping the population from regrowing, which is why this guard
 * exists rather than another sweep.
 */

function sourceFiles(): string[] {
  return execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter(Boolean);
}

/**
 * Overlays that are deliberately not dialogs. Each needs a reason, because
 * "it's fine" is how the last population grew.
 *
 * - `upload/DropZone` — the full-screen layer is a *drop target* shown while a
 *   file is dragged over the window. It holds no focusable content, is
 *   `aria-hidden` when inactive, and is dismissed by dropping or leaving. There
 *   is nothing to trap and nothing to escape from.
 * - `store/GlassPage` — two `-z-10 aria-hidden` background washes painted
 *   behind the page. Decorative, never interactive.
 */
const NOT_DIALOGS = new Set([
  'src/components/upload/DropZone.tsx',
  'src/components/store/GlassPage.tsx',
]);

/**
 * A scrim that closes something: `fixed inset-0` on an element carrying an
 * `onClick` dismiss. Comments are stripped first — `ContactHistoryDrawer`
 * *describes* the old `fixed inset-0` pattern in prose while correctly using
 * `ui/Drawer`, and an earlier version of this scan reported it for that.
 */
const SCRIM = /fixed inset-0/;
const DISMISSING = /onClick=\{\(\)\s*=>\s*(?:set\w+\(false\)|on\w*[Cc]lose)/;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i >= 0 && !/["'`]/.test(line.slice(0, i)) ? line.slice(0, i) : line;
    })
    .join('\n');
}

/**
 * Only the hook counts. Matching a `ui/Modal` / `ui/Drawer` import instead was
 * the first version of this, and it let the library page through: that file
 * imports `Drawer` for its filter sheet while ALSO hand-rolling a release
 * dropdown with a bare scrim and no Escape. A file-level import proves nothing
 * about the particular overlay being scanned.
 */
const HANDLED = /useDialogBehavior/;

describe('full-screen overlays', () => {
  it('give keyboard users Escape and focus restoration', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      if (NOT_DIALOGS.has(file) || file.endsWith('.test.tsx')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (!SCRIM.test(src) || !DISMISSING.test(src)) continue;
      if (HANDLED.test(src)) continue;
      violations.push(file);
    }
    expect(
      violations,
      `Found ${violations.length} dismissable full-screen overlay(s) with no Escape and no focus restoration. Attach hooks/useDialogBehavior — trapFocus: true for dialogs, false for anchored popovers and menus — or render through ui/Modal / ui/Drawer / ui/Popover:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
