import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as lucide from 'lucide-react';
import { ICONS, ICON_SIZES, ICON_STROKES, RETIRED_ICONS } from './icons';

/**
 * Guards for the icon system (UI-02). Source-text scans, like
 * tailwind-classes.test.ts: `tsc` and a green build cannot tell that a warning
 * is drawn three different ways, or that a close button has no name.
 *
 * Scope is deliberate:
 *  - retired aliases: every file under src/, except the public storefront
 *    (src/app/store/**), which is a follow-up (its CSP is enforced and it needs
 *    its own pass);
 *  - sizes / strokes: only the files UI-02 migrated (MIGRATED). A guard that was
 *    red for 250 untouched files would be turned off; widen the list as files
 *    are migrated;
 *  - unnamed icon-only controls: the same migrated files plus the ones the audit
 *    fixed (NAMED). The pattern is exact on what it matches but cannot parse
 *    every JSX shape, so it is not run over all of src.
 */

const MIGRATED = [
  'src/components/nav/TopBar.tsx',
  'src/components/nav/model.ts',
  'src/components/projects/ProjectDetailHeader.tsx',
  'src/components/system/IconGallery.tsx',
  'src/components/ui/ActionMenu.tsx',
  'src/components/ui/BatchActionBar.tsx',
  'src/components/ui/Button.tsx',
  'src/components/ui/CoverEditor.tsx',
  'src/components/ui/Drawer.tsx',
  'src/components/ui/Dropdown.tsx',
  'src/components/ui/Modal.tsx',
  'src/components/ui/Toaster.tsx',
];

/** Files whose icon-only buttons the audit found without an accessible name. */
const NAMED = [
  ...MIGRATED,
  'src/app/(dashboard)/library/[id]/page.tsx',
  'src/app/(dashboard)/playlists/[id]/page.tsx',
  'src/app/projects/share/[token]/page.tsx',
  'src/app/share/[token]/page.tsx',
  'src/components/calendar/CalendarView.tsx',
  'src/components/share/variants/ClientShareVariant.tsx',
];

function tracked(): string[] {
  return execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'));
}

const read = (f: string) => readFileSync(f, 'utf8');

/** Names imported from 'lucide-react' (the source name, before any `as`). */
function lucideImports(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('icon map module', () => {
  it('maps every concept to a real lucide icon', () => {
    for (const [concept, Icon] of Object.entries(ICONS)) {
      expect(Icon, concept).toBeTruthy();
      expect(Object.values(lucide).includes(Icon as never), `${concept} is not a lucide export`).toBe(true);
    }
  });

  it('never draws two concepts with the same icon', () => {
    const seen = new Map<unknown, string>();
    for (const [concept, Icon] of Object.entries(ICONS)) {
      expect(seen.get(Icon), `${concept} reuses the icon of ${seen.get(Icon)}`).toBeUndefined();
      seen.set(Icon, concept);
    }
  });

  it('retires aliases in favour of icons that exist', () => {
    for (const [retired, replacement] of Object.entries(RETIRED_ICONS)) {
      expect(replacement in lucide, `${replacement} (replacing ${retired}) is not a lucide export`).toBe(true);
      expect(Object.keys(RETIRED_ICONS)).not.toContain(replacement);
    }
  });
});

describe('icon usage', () => {
  it('imports no retired lucide alias (storefront excepted)', () => {
    const offenders: string[] = [];
    for (const f of tracked()) {
      if (f.startsWith('src/app/store/')) continue;
      for (const name of lucideImports(read(f))) {
        if (name in RETIRED_ICONS) offenders.push(`${f}: ${name} → ${RETIRED_ICONS[name]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses only scale sizes and strokes in migrated files', () => {
    const offenders: string[] = [];
    for (const f of MIGRATED) {
      const src = read(f);
      for (const m of src.matchAll(/\bsize=\{(\d+(?:\.\d+)?)\}/g)) {
        if (!ICON_SIZES.includes(Number(m[1]))) offenders.push(`${f}: size={${m[1]}}`);
      }
      for (const m of src.matchAll(/\bstrokeWidth=\{(\d+(?:\.\d+)?)\}/g)) {
        if (!ICON_STROKES.includes(Number(m[1]))) offenders.push(`${f}: strokeWidth={${m[1]}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every icon-only button or link in audited files an accessible name', () => {
    // <button …><Icon …/></button> with nothing else inside. A tag whose attributes contain `>`
    // (an arrow function) does not match, so this can miss a case but never reports a named one.
    const re = /<(button|a|Link)\b((?:[^>]|=>)*?)>\s*<([A-Z]\w*)\b([^>]*?)\/>\s*<\/\1>/g;
    const offenders: string[] = [];
    for (const f of NAMED) {
      const src = read(f);
      for (const m of src.matchAll(re)) {
        if (!/aria-label|aria-labelledby|title=|sr-only/.test(m[2] + m[4])) {
          offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
