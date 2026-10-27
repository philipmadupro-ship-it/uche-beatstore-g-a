import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RELEASE_ARTWORK_KINDS,
  RELEASE_MASTER_RELATIONS,
  RELEASE_STATES,
  RELEASE_STATES_NOT_GOING_OUT,
  RELEASE_STATES_ON_RELEASE,
  RELEASE_TYPES,
  countsAsOnRelease,
  nextItemPosition,
  planItemRemoval,
  planReorder,
  positionsContiguous,
  releaseArtworkProblem,
  releaseMasterProblem,
  toReleaseItemView,
  toReleaseView,
} from './releases';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/144_labelos_releases.sql'), 'utf8').replace(/--[^\n]*/g, '');
/** 193 (LABEL-56) widens the state list and redefines the release arm; the vocabularies follow it. */
const LIFECYCLE = readFileSync(join(process.cwd(), 'supabase/migrations/193_labelos_release_lifecycle.sql'), 'utf8').replace(/--[^\n]*/g, '');

/** The quoted values of the first `<column> [NOT] IN (...)` after `anchor`. */
function listAfter(anchor: string, column: string): string[] {
  const at = MIGRATION.indexOf(anchor);
  if (at < 0) throw new Error(`${anchor} not found in 144`);
  const m = MIGRATION.slice(at).match(new RegExp(`${column}\\s+(?:NOT\\s+)?IN\\s*\\(([^)]*)\\)`, 'i'));
  if (!m) throw new Error(`no ${column} IN (…) after ${anchor}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('the vocabularies are the 144 CHECKs and trigger lists', () => {
  it('types, states, master relations, artwork kinds and the state that takes a song off a release', () => {
    expect(listAfter('CONSTRAINT releases_type_check', 'type')).toEqual([...RELEASE_TYPES]);
    const lifecycleList = (anchor: string, column: string) =>
      [...LIFECYCLE.slice(LIFECYCLE.indexOf(anchor)).match(new RegExp(`${column}\\s+(?:NOT\\s+)?IN\\s*\\(([^)]*)\\)`, 'i'))![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(lifecycleList('CONSTRAINT releases_state_check', 'state')).toEqual([...RELEASE_STATES]);
    expect(listAfter('FUNCTION public.release_items_integrity', 'relation')).toEqual([...RELEASE_MASTER_RELATIONS]);
    expect(listAfter('FUNCTION public.releases_integrity', 'kind')).toEqual([...RELEASE_ARTWORK_KINDS]);
    expect(lifecycleList('FUNCTION public.labelos_track_is_finished', 'state')).toEqual([...RELEASE_STATES_ON_RELEASE]);
  });
});

describe('releaseMasterProblem (the release_items trigger, 17 R1)', () => {
  const song = { id: 'S', type: 'song' };
  it('the song itself is its own master', () => {
    expect(releaseMasterProblem(song, 'S', [])).toBeNull();
  });

  it('a track the song links to as master, instrumental or version', () => {
    for (const relation of RELEASE_MASTER_RELATIONS) {
      expect(releaseMasterProblem(song, 'M', [{ from_track_id: 'S', to_track_id: 'M', relation }])).toBeNull();
    }
  });

  it('a demo, loop or topline is not a master; nor is a link the other way round or from another song', () => {
    for (const relation of ['demo', 'loop', 'topline']) {
      expect(releaseMasterProblem(song, 'M', [{ from_track_id: 'S', to_track_id: 'M', relation }])).toBe('master_not_linked');
    }
    expect(releaseMasterProblem(song, 'M', [{ from_track_id: 'M', to_track_id: 'S', relation: 'master' }])).toBe('master_not_linked');
    expect(releaseMasterProblem(song, 'M', [{ from_track_id: 'S2', to_track_id: 'M', relation: 'master' }])).toBe('master_not_linked');
    expect(releaseMasterProblem(song, 'M', [])).toBe('master_not_linked');
  });

  it('only a song goes on a release', () => {
    for (const type of ['beat', 'instrumental', 'loop', null]) {
      expect(releaseMasterProblem({ id: 'S', type }, 'S', [])).toBe('not_a_song');
    }
  });
});

describe('releaseArtworkProblem', () => {
  const release = { org_id: 'L', project_id: 'P' };
  it('an artwork or photo file of the release project', () => {
    for (const kind of RELEASE_ARTWORK_KINDS) {
      expect(releaseArtworkProblem(release, { org_id: 'L', project_id: 'P', kind })).toBeNull();
    }
  });
  it('refuses another kind, another project, another org and a missing file', () => {
    expect(releaseArtworkProblem(release, { org_id: 'L', project_id: 'P', kind: 'contract' })).toBe('not_visual');
    expect(releaseArtworkProblem(release, { org_id: 'L', project_id: 'P2', kind: 'artwork' })).toBe('other_project');
    expect(releaseArtworkProblem(release, { org_id: 'L2', project_id: 'P', kind: 'artwork' })).toBe('other_project');
    expect(releaseArtworkProblem(release, null)).toBe('missing');
  });
});

describe('positions', () => {
  it('next position appends after the highest; 1 on an empty release', () => {
    expect(nextItemPosition([])).toBe(1);
    expect(nextItemPosition([{ position: 1 }, { position: 3 }, { position: 2 }])).toBe(4);
  });

  it('contiguous means exactly 1..n', () => {
    expect(positionsContiguous([])).toBe(true);
    expect(positionsContiguous([2, 1, 3])).toBe(true);
    expect(positionsContiguous([1, 3])).toBe(false);
    expect(positionsContiguous([0, 1])).toBe(false);
    expect(positionsContiguous([1, 1])).toBe(false);
  });

  it('removing an item closes the gap', () => {
    const items = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
    expect(planItemRemoval(items, 'b')).toEqual([{ id: 'a', position: 1 }, { id: 'c', position: 2 }]);
    expect(planItemRemoval(items, 'a')).toEqual([{ id: 'b', position: 1 }, { id: 'c', position: 2 }]);
    expect(planItemRemoval(items, 'zzz')).toBeNull();
  });

  it('a reorder must name every item exactly once', () => {
    const items = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
    expect(planReorder(items, ['c', 'a', 'b'])).toEqual({ ok: true, order: [{ id: 'c', position: 1 }, { id: 'a', position: 2 }, { id: 'b', position: 3 }] });
    expect(planReorder(items, ['C', 'A', 'B'])).toEqual({ ok: true, order: [{ id: 'c', position: 1 }, { id: 'a', position: 2 }, { id: 'b', position: 3 }] });
    expect(planReorder(items, ['a', 'b'])).toEqual({ ok: false, error: 'order must list every item of the release exactly once' });
    expect(planReorder(items, ['a', 'b', 'b'])).toEqual({ ok: false, error: 'order must list every item of the release exactly once' });
    expect(planReorder(items, ['a', 'b', 'x'])).toEqual({ ok: false, error: 'order must list every item of the release exactly once' });
  });
});

describe('RELEASE_STATES_NOT_GOING_OUT (LABEL-56)', () => {
  it('is cancelled and withdrawn: nothing is asked of them and their legal queue entries leave', () => {
    expect([...RELEASE_STATES_NOT_GOING_OUT].sort()).toEqual(['cancelled', 'withdrawn']);
    for (const state of RELEASE_STATES_NOT_GOING_OUT) expect(RELEASE_STATES as readonly string[]).toContain(state);
  });
});

describe('countsAsOnRelease (LABEL-56: only a release that went out finishes a song)', () => {
  const on = (state: string, imported_released?: boolean) => [{ releases: { state, imported_released } }];
  it('a draft release does not, a delivered or withdrawn one does, a cancelled one never', () => {
    expect(countsAsOnRelease([])).toBe(false);
    expect(countsAsOnRelease(on('draft'))).toBe(false);
    expect(countsAsOnRelease(on('cancelled'))).toBe(false);
    expect(countsAsOnRelease(on('delivered'))).toBe(true);
    expect(countsAsOnRelease(on('withdrawn'))).toBe(true);
    expect(countsAsOnRelease([{ releases: null }])).toBe(false);
  });
  it('a release entered as already out counts, unless it is cancelled', () => {
    expect(countsAsOnRelease(on('draft', true))).toBe(true);
    expect(countsAsOnRelease(on('draft', false))).toBe(false);
    expect(countsAsOnRelease(on('cancelled', true))).toBe(false);
  });
  it('one release that went out is enough: a draft beside it changes nothing', () => {
    expect(countsAsOnRelease([...on('draft'), ...on('delivered')])).toBe(true);
    expect(countsAsOnRelease([...on('draft'), ...on('cancelled')])).toBe(false);
  });
});
