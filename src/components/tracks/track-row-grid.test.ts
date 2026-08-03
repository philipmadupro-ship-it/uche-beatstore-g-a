import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { TRACK_ROW_GRID } from './TrackCard';

/**
 * Guards the one column template shared by track rows and their headers.
 *
 * This has already gone wrong twice, in two different ways, and neither was
 * catchable by `tsc`, ESLint, the tests or the build — a misaligned grid is
 * valid code that simply renders wrong:
 *
 *   1. The template was hand-written in three files. Widening two columns in
 *      `TrackCard` (to stop the rating stars colliding with the date) left the
 *      library and project headers labelling the wrong columns.
 *   2. The playlist header declared its own 8/9/10-column table — `#`, Title,
 *      Type, `BPM · Key`, Added, Rating, Tags — while rendering `TrackCard`
 *      rows, which are six columns. They could not line up at any breakpoint,
 *      and `Added`/`Tags` named cells that were never drawn.
 *
 * So: any file that renders a track row or its header must take the template
 * from `TRACK_ROW_GRID` rather than restating it.
 */

/** Tracked source files, minus this one (which necessarily names the pattern). */
function sourceFiles(): string[] {
  const out = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.endsWith('src/components/tracks/track-row-grid.test.ts'));
}

/** The literal column list inside `TRACK_ROW_GRID`, e.g. `40px_minmax(...)_32px`. */
const COLUMNS = TRACK_ROW_GRID.replace(/^md:grid-cols-\[/, '').replace(/\]$/, '');

describe('TRACK_ROW_GRID', () => {
  it('bakes the md: prefix into its value', () => {
    // `md:${CONST}` would assemble the class at runtime. Tailwind's scanner
    // reads source text rather than evaluating it, so the CSS would never be
    // generated and every row would collapse to a single column — which no
    // type check or test would notice.
    expect(TRACK_ROW_GRID.startsWith('md:grid-cols-[')).toBe(true);
  });

  it('is the only place the column template is written', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      let contents: string;
      try {
        contents = readFileSync(file, 'utf8');
      } catch {
        continue; // deleted between ls-files and read
      }
      // TrackCard is where the constant is defined, so it legitimately contains
      // the literal once.
      if (file.endsWith('src/components/tracks/TrackCard.tsx')) continue;
      if (contents.includes(COLUMNS)) offenders.push(file);
    }

    expect(
      offenders,
      'These files restate the track row column template instead of importing '
      + `TRACK_ROW_GRID, so they will silently drift out of alignment with the rows:\n${
        offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every file rendering a track header imports the constant', () => {
    // A header that hand-rolls its own grid is the playlist bug.
    //
    // "Track row header" has to be defined precisely or this flags page
    // furniture: the producer page renders TrackCard in a card gallery and also
    // has a `[280px_1fr]` sidebar layout, which is not a row header at all. A
    // row header is a MULTI-COLUMN template mixing fixed and flexible tracks —
    // the playlist's was `[32px_32px_1fr_90px_72px_110px_110px_32px]`. Four or
    // more tracks with at least two fixed px widths captures that and leaves
    // two-track layout grids alone.
    const isRowLikeTemplate = (template: string): boolean => {
      const tracks = template.split('_');
      if (tracks.length < 4) return false;
      return tracks.filter((t) => /^\d+px$/.test(t)).length >= 2;
    };

    const suspicious: string[] = [];
    for (const file of sourceFiles()) {
      let contents: string;
      try {
        contents = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (!contents.includes('<TrackCard')) continue;
      if (contents.includes('TRACK_ROW_GRID')) continue;

      const templates = [...contents.matchAll(/grid-cols-\[([^\]]+)\]/g)].map((m) => m[1]);
      if (templates.some(isRowLikeTemplate)) suspicious.push(file);
    }

    expect(
      suspicious,
      `These files render <TrackCard> beneath a hand-written column grid:\n${suspicious.join('\n')}`,
    ).toEqual([]);
  });
});
