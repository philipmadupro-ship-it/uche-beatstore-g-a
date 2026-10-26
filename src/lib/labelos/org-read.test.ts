import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINISHED_LINK_RELATIONS,
  OPEN_ASSET_KINDS,
  orgAssetReadable,
  orgProjectScopeContacts,
  orgRowAudioAllows,
  orgTrackReadClass,
} from './org-read';
import { recordingClass } from './capabilities';
import { recordingKindOf } from './recording-kind';
import { RELEASE_STATES_OFF_RELEASE } from './releases';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/141_labelos_org_catalog.sql'), 'utf8').replace(/--[^\n]*/g, '');

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');

/**
 * The body of the LAST CREATE OR REPLACE of a function across the
 * migrations — what the database runs. `labelos_track_is_finished` was
 * written by 141 and replaced by 144 (LABEL-16).
 */
function functionBody(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'g');
  let body: string | null = null;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(re)) body = m[1];
  }
  if (!body) throw new Error(`${name} not found in any migration`);
  return body;
}

/** The quoted values of every `<column> [NOT] IN (...)` in a SQL fragment. */
function inLists(sql: string, column: string): string[][] {
  return [...sql.matchAll(new RegExp(`${column}\\s+(?:NOT\\s+)?IN\\s*\\(([^)]*)\\)`, 'gi'))].map((m) =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
  );
}

describe('orgTrackReadClass (the SQL twin of labelos_track_is_finished)', () => {
  it('a selected song is finished: its current audio is the finished mix (17 R1)', () => {
    expect(orgTrackReadClass({ type: 'song', song_stage: 'selected' }, [])).toBe('finished');
  });

  it('a song at any other stage is working', () => {
    for (const stage of ['inbox', 'in_review', 'shortlisted', 'in_development', 'on_hold', 'passed', 'archived', null]) {
      expect(orgTrackReadClass({ type: 'song', song_stage: stage }, [])).toBe('working');
    }
  });

  it("a song's master or instrumental is finished", () => {
    for (const relation of ['master', 'instrumental'] as const) {
      expect(orgTrackReadClass({ type: 'song', song_stage: null }, [{ relation, fromType: 'song' }])).toBe('finished');
    }
  });

  it('a master link from something that is not a song does not make a track finished', () => {
    expect(orgTrackReadClass({ type: 'song', song_stage: null }, [{ relation: 'master', fromType: 'beat' }])).toBe('working');
  });

  it('demos, loops, toplines, versions and beats are working', () => {
    for (const relation of ['demo', 'loop', 'topline', 'version', 'beat'] as const) {
      expect(orgTrackReadClass({ type: 'song', song_stage: null }, [{ relation, fromType: 'song' }])).toBe('working');
    }
  });

  it('any working link wins over a finished one (the narrower reading, never a guess)', () => {
    expect(
      orgTrackReadClass({ type: 'song', song_stage: 'selected' }, [
        { relation: 'master', fromType: 'song' },
        { relation: 'version', fromType: 'song' },
      ]),
    ).toBe('working');
  });

  it('unlinked material the R1 table does not classify reads as working, never finished', () => {
    for (const type of ['beat', 'instrumental', 'remix', 'loop', 'topline', null]) {
      expect(orgTrackReadClass({ type, song_stage: null }, [])).toBe('working');
    }
  });

  it('never calls finished what recordingClass would call working', () => {
    const relations = ['master', 'instrumental', 'demo', 'loop', 'topline', 'version', 'beat'] as const;
    for (const relation of relations) {
      const kind = recordingKindOf({ type: 'song' }, relation);
      const cls = kind ? recordingClass(kind) : null;
      if (orgTrackReadClass({ type: 'song', song_stage: null }, [{ relation, fromType: 'song' }]) === 'finished') {
        expect(cls).toBe('finished');
      }
    }
  });

  it('FINISHED_LINK_RELATIONS are exactly the relation lists in labelos_track_is_finished (141, as replaced by 144)', () => {
    const lists = inLists(functionBody('labelos_track_is_finished'), 'relation');
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list).toEqual([...FINISHED_LINK_RELATIONS]);
  });

  it('a song on a release is finished at any stage (06 §2.3, LABEL-16)', () => {
    for (const stage of ['inbox', 'in_review', 'in_development', null]) {
      expect(orgTrackReadClass({ type: 'song', song_stage: stage, on_release: true }, [])).toBe('finished');
      expect(orgTrackReadClass({ type: 'song', song_stage: stage, on_release: false }, [])).toBe('working');
    }
  });

  it('… but a working link into it still wins, and a non-song is never finished by it', () => {
    expect(orgTrackReadClass({ type: 'song', song_stage: null, on_release: true }, [{ relation: 'version', fromType: 'song' }])).toBe('working');
    expect(orgTrackReadClass({ type: 'beat', song_stage: null, on_release: true }, [])).toBe('working');
  });

  it('the SQL twin has the release arm: a song item of a release that is not cancelled', () => {
    const body = functionBody('labelos_track_is_finished');
    expect(body).toMatch(/JOIN public\.release_items ri ON ri\.song_track_id = t\.id/);
    expect(body).toMatch(/t\.type = 'song'/);
    expect(inLists(body, 'state')).toEqual([[...RELEASE_STATES_OFF_RELEASE]]);
  });
});

describe('orgRowAudioAllows', () => {
  it('working material needs audio.working', () => {
    expect(orgRowAudioAllows(new Set(['catalog.read', 'audio.finished']), 'working')).toBe(false);
    expect(orgRowAudioAllows(new Set(['catalog.read', 'audio.working']), 'working')).toBe(true);
  });

  it('finished material needs audio.finished or audio.working', () => {
    expect(orgRowAudioAllows(new Set(['catalog.read', 'audio.finished']), 'finished')).toBe(true);
    expect(orgRowAudioAllows(new Set(['catalog.read', 'audio.working']), 'finished')).toBe(true);
    expect(orgRowAudioAllows(new Set(['catalog.read']), 'finished')).toBe(false);
  });
});

describe('orgAssetReadable', () => {
  it('artwork and lyrics need only catalog.read; every other kind needs audio.working (until LABEL-15)', () => {
    const marketing = new Set(['catalog.read', 'audio.finished']);
    const ar = new Set(['catalog.read', 'audio.working', 'audio.finished']);
    for (const kind of ['artwork', 'lyrics']) expect(orgAssetReadable(marketing, kind)).toBe(true);
    for (const kind of ['reference', 'document', 'audio', 'other', 'contract', 'unknown']) {
      expect(orgAssetReadable(marketing, kind)).toBe(false);
      expect(orgAssetReadable(ar, kind)).toBe(true);
    }
  });

  it('OPEN_ASSET_KINDS are exactly the kind list in both project_assets policies (migration 141)', () => {
    for (const name of ['org_member_read', 'org_member_guard']) {
      const policy = MIGRATION.match(new RegExp(`CREATE POLICY ${name} ON public\\.project_assets([\\s\\S]*?);`))?.[1] ?? '';
      expect(inLists(policy, 'kind')).toEqual([[...OPEN_ASSET_KINDS]]);
    }
  });
});

describe('orgProjectScopeContacts', () => {
  it('a project is scoped by its inbox artist and every linked contact, deduplicated', () => {
    expect(orgProjectScopeContacts({ inbox_for_contact_id: 'A' }, ['B', 'A', null])).toEqual(['A', 'B']);
  });

  it('a project with neither has no artist (whole-org members only)', () => {
    expect(orgProjectScopeContacts({ inbox_for_contact_id: null }, [])).toEqual([]);
  });
});
