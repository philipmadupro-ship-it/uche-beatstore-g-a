import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capabilitiesFor, type Capability, type Role } from './capabilities';
import {
  STAGE_TRANSITIONS,
  allowedTransitions,
  initialSongStage,
  isReleased,
  isSongStage,
  transition,
  SONG_STAGES,
  type SongStage,
} from './song-stage';

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

// ── Transitions (LABEL-24) ──────────────────────────────────────────────

/** 04 W3's diagram, written out edge by edge: the table is checked against this, not against itself. */
const LEGAL: Readonly<Record<SongStage, readonly SongStage[]>> = {
  inbox: ['in_review', 'passed', 'archived'],
  in_review: ['shortlisted', 'passed', 'on_hold', 'archived'],
  shortlisted: ['in_development', 'passed', 'on_hold', 'archived'],
  in_development: ['selected', 'passed', 'on_hold', 'archived'],
  selected: ['archived'],
  // Not drawn in 04 W3, which only says passed demos "are regularly revisited": a way back in.
  on_hold: ['in_review', 'archived'],
  passed: ['in_review', 'archived'],
  archived: ['in_review'],
};

/** The capability sets the 06 §2.4 matrix names for someone who can or cannot write the catalogue. */
const caps = (role: Role, functions: string[] = []): ReadonlySet<Capability> => capabilitiesFor('label', role, functions);
const ACTORS: Array<{ name: string; caps: ReadonlySet<Capability>; role: Role; writes: boolean; artist: boolean }> = [
  { name: 'owner', caps: caps('owner'), role: 'owner', writes: true, artist: false },
  { name: 'admin', caps: caps('admin'), role: 'admin', writes: true, artist: false },
  { name: 'member a_and_r', caps: caps('member', ['a_and_r']), role: 'member', writes: true, artist: false },
  { name: 'member project_manager', caps: caps('member', ['project_manager']), role: 'member', writes: true, artist: false },
  { name: 'member artist_manager', caps: caps('member', ['artist_manager']), role: 'member', writes: true, artist: false },
  { name: 'member producer', caps: caps('member', ['producer']), role: 'member', writes: true, artist: false },
  { name: 'member engineer', caps: caps('member', ['engineer']), role: 'member', writes: true, artist: false },
  { name: 'member marketing', caps: caps('member', ['marketing']), role: 'member', writes: false, artist: false },
  { name: 'member legal', caps: caps('member', ['legal']), role: 'member', writes: false, artist: false },
  { name: 'member finance', caps: caps('member', ['finance']), role: 'member', writes: false, artist: false },
  { name: 'member with no function', caps: caps('member'), role: 'member', writes: false, artist: false },
  { name: 'roster artist', caps: caps('artist'), role: 'artist', writes: true, artist: true },
  { name: 'roster artist, catalog.write revoked', caps: capabilitiesFor('label', 'artist', [], { revoke: ['catalog.write'] }), role: 'artist', writes: false, artist: true },
];

describe('STAGE_TRANSITIONS', () => {
  it('has a row for every stage and only names real stages', () => {
    expect(Object.keys(STAGE_TRANSITIONS).sort()).toEqual([...SONG_STAGES].sort());
    for (const to of Object.values(STAGE_TRANSITIONS).flat()) expect(isSongStage(to)).toBe(true);
  });
  it('is the 04 W3 diagram, edge for edge', () => {
    for (const from of SONG_STAGES) expect([...STAGE_TRANSITIONS[from]].sort()).toEqual([...LEGAL[from]].sort());
  });
  it('never moves a stage to itself, and `released` is not a stage anyone can move to', () => {
    for (const from of SONG_STAGES) {
      expect(STAGE_TRANSITIONS[from]).not.toContain(from);
      expect(STAGE_TRANSITIONS[from] as readonly string[]).not.toContain('released');
    }
  });
  it('lets every stage reach archived except archived itself (04: "any → archive")', () => {
    for (const from of SONG_STAGES) if (from !== 'archived') expect(STAGE_TRANSITIONS[from]).toContain('archived');
  });
  it('keeps selected one-way: a selected song is archived, not passed or held (it is chosen for a release)', () => {
    expect(STAGE_TRANSITIONS.selected).toEqual(['archived']);
  });
});

describe('allowedTransitions — every stage × every capability set', () => {
  for (const actor of ACTORS) {
    describe(actor.name, () => {
      for (const from of SONG_STAGES) {
        const expected = !actor.writes ? [] : actor.artist ? (from === 'inbox' ? ['in_review'] : []) : LEGAL[from];
        it(`${from} → ${expected.length ? expected.join(', ') : 'nothing'}`, () => {
          expect([...allowedTransitions(from, actor.caps, actor.role)].sort()).toEqual([...expected].sort());
        });
      }
    });
  }

  it('without a role it reads capabilities alone', () => {
    expect([...allowedTransitions('inbox', caps('owner'))].sort()).toEqual([...LEGAL.inbox].sort());
    expect(allowedTransitions('inbox', caps('member', ['marketing']))).toEqual([]);
  });
  it('returns nothing for an unknown or null stage', () => {
    expect(allowedTransitions('released' as never, caps('owner'))).toEqual([]);
    expect(allowedTransitions(null as never, caps('owner'))).toEqual([]);
  });
});

describe('transition — every (from, to) pair', () => {
  for (const actor of ACTORS) {
    for (const from of SONG_STAGES) {
      for (const to of SONG_STAGES) {
        const allowed = !actor.writes ? [] : actor.artist ? (from === 'inbox' ? ['in_review'] : []) : LEGAL[from];
        it(`${actor.name}: ${from} → ${to} is ${allowed.includes(to) ? 'legal' : 'refused'}`, () => {
          const r = transition({ type: 'song', stage: from }, to, { caps: actor.caps, role: actor.role });
          expect(r.ok).toBe(allowed.includes(to));
        });
      }
    }
  }

  it('answers with from and to on success', () => {
    expect(transition({ type: 'song', stage: 'inbox' }, 'in_review', { caps: caps('owner'), role: 'owner' })).toEqual({ ok: true, from: 'inbox', to: 'in_review' });
  });
  it('names from and to in the message of an illegal move, and says which rule refused it', () => {
    const r = transition({ type: 'song', stage: 'inbox' }, 'selected', { caps: caps('owner'), role: 'owner' });
    expect(r).toMatchObject({ ok: false, reason: 'illegal' });
    if (!r.ok) expect(r.message).toBe('A song cannot move from Inbox to Selected');
  });
  it('tells an artist it is their own limit', () => {
    const r = transition({ type: 'song', stage: 'in_review' }, 'shortlisted', { caps: caps('artist'), role: 'artist' });
    expect(r).toMatchObject({ ok: false, reason: 'illegal' });
    if (!r.ok) expect(r.message).toContain('In review');
  });
  it('a member without catalog.write is forbidden, not illegal', () => {
    expect(transition({ type: 'song', stage: 'inbox' }, 'in_review', { caps: caps('member', ['marketing']), role: 'member' })).toMatchObject({ ok: false, reason: 'forbidden' });
  });
  it('without an actor it judges the table only', () => {
    expect(transition({ type: 'song', stage: 'inbox' }, 'in_review').ok).toBe(true);
    expect(transition({ type: 'song', stage: 'inbox' }, 'selected').ok).toBe(false);
  });
  it('refuses a no-op move', () => {
    expect(transition({ type: 'song', stage: 'inbox' }, 'inbox')).toMatchObject({ ok: false, reason: 'same' });
  });
  it('refuses a target that is not a stage (including released, which is derived)', () => {
    expect(transition({ type: 'song', stage: 'selected' }, 'released' as never)).toMatchObject({ ok: false, reason: 'unknown_stage' });
    expect(transition({ type: 'song', stage: 'selected' }, '' as never)).toMatchObject({ ok: false, reason: 'unknown_stage' });
  });
  it('refuses anything that is not a song with a stage', () => {
    expect(transition({ type: 'beat', stage: null }, 'in_review')).toMatchObject({ ok: false, reason: 'not_a_song' });
    expect(transition({ type: 'song', stage: null }, 'in_review')).toMatchObject({ ok: false, reason: 'not_a_song' });
    expect(transition({ type: 'song', stage: 'bogus' }, 'in_review')).toMatchObject({ ok: false, reason: 'not_a_song' });
  });
});

describe('isReleased', () => {
  const on = (state: string) => ({ releases: { state } });
  it('is a fact about the release, the rule the audio classifier uses', () => {
    expect(isReleased({ stage: 'selected' }, [on('delivered')])).toBe(true);
    expect(isReleased({ stage: 'selected' }, [on('draft')])).toBe(true);
  });
  it('is false with no release, a dangling item, or only a cancelled release', () => {
    expect(isReleased({ stage: 'selected' }, [])).toBe(false);
    expect(isReleased({ stage: 'selected' }, [{ releases: null }])).toBe(false);
    expect(isReleased({ stage: 'selected' }, [on('cancelled')])).toBe(false);
  });
  it('one live release among cancelled ones is enough', () => {
    expect(isReleased({ stage: 'selected' }, [on('cancelled'), on('delivered')])).toBe(true);
  });
  it('does not depend on the stored stage', () => {
    expect(isReleased({ stage: 'archived' }, [on('delivered')])).toBe(true);
    expect(isReleased({ stage: 'inbox' }, [])).toBe(false);
  });
});
