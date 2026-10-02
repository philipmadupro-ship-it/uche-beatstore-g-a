import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialSongStage, isSongStage, SONG_STAGES } from './song-stage';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/140_labelos_song_fields.sql'), 'utf8');

/** The quoted values inside a named CHECK constraint in migration 140. */
function checkValues(constraint: string): string[] {
  const m = MIGRATION.match(new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\(([^;]*?)\\)\\s*(?:NOT VALID)?;`, 's'));
  if (!m) throw new Error(`${constraint} not found in migration 140`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('SONG_STAGES', () => {
  it('are the 04 W3 stages, with released derived and never stored', () => {
    expect([...SONG_STAGES]).toEqual(['inbox', 'in_review', 'shortlisted', 'in_development', 'selected', 'on_hold', 'passed', 'archived']);
    expect(isSongStage('released')).toBe(false);
    expect(isSongStage('approved')).toBe(false);
    expect(isSongStage('changes_requested')).toBe(false);
    expect(isSongStage('inbox')).toBe(true);
    expect(isSongStage(null)).toBe(false);
  });
  it('match the tracks_song_stage_check constraint in migration 140 exactly', () => {
    expect(checkValues('tracks_song_stage_check')).toEqual([...SONG_STAGES]);
  });
});

describe('initialSongStage', () => {
  it('is inbox for a new org song', () => {
    expect(initialSongStage({ type: 'song', orgId: 'org-1' })).toBe('inbox');
  });
  it('is null for a producer song (org_id null) — the producer library never gets a stage', () => {
    expect(initialSongStage({ type: 'song', orgId: null })).toBeNull();
    expect(initialSongStage({ type: 'song' })).toBeNull();
  });
  it('is null for anything that is not a song', () => {
    for (const type of ['beat', 'instrumental', 'remix', 'loop', 'topline', null]) {
      expect(initialSongStage({ type, orgId: 'org-1' })).toBeNull();
    }
  });
});
