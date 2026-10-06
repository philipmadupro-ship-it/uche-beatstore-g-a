import { describe, expect, it } from 'vitest';
import { VERBS } from './activity';
import {
  VERB_PHRASES,
  buildDigest,
  dayKey,
  describeLine,
  describePart,
  sinceWindow,
  type DigestEvent,
  type DigestNames,
} from './digest';

const SAM = '00000000-0000-4000-8000-0000000000a1';
const PRIYA = '00000000-0000-4000-8000-0000000000a2';
const NOVA = '00000000-0000-4000-8000-0000000000c1';
const KILO = '00000000-0000-4000-8000-0000000000c2';
const P1 = '00000000-0000-4000-8000-0000000000d1';
const P2 = '00000000-0000-4000-8000-0000000000d2';
const S1 = '00000000-0000-4000-8000-0000000000b1';
const S2 = '00000000-0000-4000-8000-0000000000b2';
const S3 = '00000000-0000-4000-8000-0000000000b3';
const R1 = '00000000-0000-4000-8000-0000000000e1';
const R2 = '00000000-0000-4000-8000-0000000000e2';

let n = 0;
function ev(over: Partial<DigestEvent> & Pick<DigestEvent, 'verb' | 'at'>): DigestEvent {
  n += 1;
  return {
    id: `ev-${n}`,
    actorId: SAM,
    artistId: null,
    projectId: null,
    songId: null,
    releaseId: null,
    subjectId: `subject-${n}`,
    summary: {},
    ...over,
  };
}

const NAMES: DigestNames = {
  actors: { [SAM]: 'Sam', [PRIYA]: 'Priya' },
  artists: { [NOVA]: 'Nova', [KILO]: 'Kilo' },
  releases: { [R1]: 'EP 2027', [R2]: 'Singles' },
  songs: { [S1]: 'Midnight', [S2]: 'Dawn' },
};

describe('dayKey', () => {
  it('names the calendar day in the given zone', () => {
    const at = '2026-10-05T23:30:00Z';
    expect(dayKey(at, 'UTC')).toBe('2026-10-05');
    expect(dayKey(at, 'Europe/Paris')).toBe('2026-10-06');
    expect(dayKey(at, 'America/Los_Angeles')).toBe('2026-10-05');
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    expect(dayKey('2026-10-05T23:30:00Z', 'Not/AZone')).toBe('2026-10-05');
  });
});

describe('sinceWindow', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('starts at the last visit', () => {
    expect(sinceWindow('2026-10-04T08:00:00Z', now)).toBe('2026-10-04T08:00:00.000Z');
  });
  it('looks back a week when there was no visit', () => {
    expect(sinceWindow(null, now)).toBe('2026-09-29T12:00:00.000Z');
  });
  it('never looks back further than 30 days', () => {
    expect(sinceWindow('2026-01-01T00:00:00Z', now)).toBe('2026-09-06T12:00:00.000Z');
  });
  it('treats a visit in the future (clock skew) as now, and garbage as no visit', () => {
    expect(sinceWindow('2027-01-01T00:00:00Z', now)).toBe('2026-10-06T12:00:00.000Z');
    expect(sinceWindow('yesterday', now)).toBe('2026-09-29T12:00:00.000Z');
  });
});

describe('buildDigest — one grouped line per actor per day', () => {
  it('renders 10 uploads within 10 minutes as one line', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      ev({ verb: 'song.created', at: `2026-10-05T09:0${i}:30Z`, artistId: NOVA, songId: `s${i}`, subjectId: `s${i}`, summary: { stage: 'inbox' } }),
    );
    const d = buildDigest(events, { view: 'overview' });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].artistId).toBe(NOVA);
    expect(d.sections[0].days).toHaveLength(1);
    const lines = d.sections[0].days[0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].parts).toEqual([{ kind: 'verb', verb: 'song.created', count: 10, demos: 10 }]);
    expect(lines[0].events).toBe(10);
    expect(describeLine(lines[0], NAMES)).toEqual({ actor: 'Sam', text: 'added 10 demos' });
  });

  it('keeps the same burst as one line even when it is spread over the day', () => {
    const events = [
      ev({ verb: 'song.created', at: '2026-10-05T08:00:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
      ev({ verb: 'song.created', at: '2026-10-05T17:45:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
    ];
    const lines = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].parts[0]).toMatchObject({ count: 2 });
  });

  it('splits by artist, then day, then actor, newest first', () => {
    const events = [
      ev({ verb: 'song.created', at: '2026-10-04T10:00:00Z', artistId: NOVA, actorId: SAM }),
      ev({ verb: 'song.created', at: '2026-10-05T10:00:00Z', artistId: NOVA, actorId: SAM }),
      ev({ verb: 'song.created', at: '2026-10-05T11:00:00Z', artistId: NOVA, actorId: PRIYA }),
      ev({ verb: 'song.created', at: '2026-10-05T12:00:00Z', artistId: KILO, actorId: SAM }),
    ];
    const d = buildDigest(events, { view: 'overview' });
    expect(d.events).toBe(4);
    // Kilo's activity is the latest, so it leads.
    expect(d.sections.map((s) => s.artistId)).toEqual([KILO, NOVA]);
    const nova = d.sections[1];
    expect(nova.days.map((x) => x.day)).toEqual(['2026-10-05', '2026-10-04']);
    expect(nova.days[0].lines.map((l) => l.actorId)).toEqual([PRIYA, SAM]);
  });

  it('collects several verbs of one actor on one day into one line, in a stable order', () => {
    const events = [
      ev({ verb: 'file.uploaded', at: '2026-10-05T10:00:00Z', artistId: NOVA }),
      ev({ verb: 'project.created', at: '2026-10-05T10:01:00Z', artistId: NOVA }),
      ev({ verb: 'song.created', at: '2026-10-05T10:02:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
      ev({ verb: 'song.created', at: '2026-10-05T10:03:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
      ev({ verb: 'song.created', at: '2026-10-05T10:04:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
    ];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('added 3 demos, created a project and added a file');
  });

  it('counts a file edited five times as one file, not five', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ verb: 'file.updated', at: `2026-10-05T10:0${i}:00Z`, artistId: NOVA, subjectId: 'same-file' }),
    );
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts).toEqual([{ kind: 'verb', verb: 'file.updated', count: 1 }]);
    expect(line.events).toBe(5);
    expect(describeLine(line, NAMES).text).toBe('edited a file');
  });

  it('only calls new songs demos when they all arrived as inbox', () => {
    const events = [
      ev({ verb: 'song.created', at: '2026-10-05T10:00:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
      ev({ verb: 'song.created', at: '2026-10-05T10:01:00Z', artistId: NOVA, summary: { stage: 'selected' } }),
    ];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('added 2 songs');
  });

  it('groups by the day in the viewer’s time zone', () => {
    const events = [ev({ verb: 'song.created', at: '2026-10-05T23:30:00Z', artistId: NOVA })];
    expect(buildDigest(events, { view: 'overview', timeZone: 'UTC' }).sections[0].days[0].day).toBe('2026-10-05');
    expect(buildDigest(events, { view: 'overview', timeZone: 'Europe/Paris' }).sections[0].days[0].day).toBe('2026-10-06');
  });
});

describe('buildDigest — release edits collapse', () => {
  const at = (m: number) => `2026-10-05T10:${String(m).padStart(2, '0')}:00Z`;
  const rel = (m: number, summary: DigestEvent['summary'], verb = 'release.updated', id = R1) =>
    ev({ verb, at: at(m), artistId: NOVA, projectId: P1, releaseId: id, subjectId: id, summary });

  it('prints one line for one reordering, not one per move', () => {
    const events = [rel(1, { items: 'reordered' }), rel(2, { items: 'reordered' }), rel(3, { items: 'added' }), rel(4, { items: 'removed' }), rel(5, { items: 'edited' })];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts).toHaveLength(1);
    expect(line.events).toBe(5);
    expect(describeLine(line, NAMES).text).toBe('edited the tracklist of ‘EP 2027’');
  });

  it('says the release was updated when only its fields changed, and both when both did', () => {
    const fields = buildDigest([rel(1, {}), rel(2, {})], { view: 'overview' }).sections[0].days[0].lines[0];
    expect(describeLine(fields, NAMES).text).toBe('updated ‘EP 2027’');
    const both = buildDigest([rel(1, {}), rel(2, { items: 'added' })], { view: 'overview' }).sections[0].days[0].lines[0];
    expect(describeLine(both, NAMES).text).toBe('updated ‘EP 2027’ and its tracklist');
  });

  it('reads a cancel from payload.state', () => {
    const [line] = buildDigest([rel(1, { state: { from: 'draft', to: 'cancelled' } }), rel(2, { items: 'reordered' })], { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('cancelled ‘EP 2027’');
  });

  it('lets a new release absorb its first edits, and a delete absorb everything', () => {
    const created = buildDigest([rel(1, {}, 'release.created'), rel(2, { items: 'added' }), rel(3, { items: 'added' })], { view: 'overview' }).sections[0].days[0].lines[0];
    expect(describeLine(created, NAMES).text).toBe('created the release ‘EP 2027’');
    const gone = buildDigest([rel(1, {}, 'release.created'), rel(2, { title: 'EP 2027' }, 'release.deleted')], { view: 'overview' }).sections[0].days[0].lines[0];
    expect(describeLine(gone, NAMES).text).toBe('deleted the release ‘EP 2027’');
  });

  it('mentions the project a release was made in first: "created a project and created the release"', () => {
    const events = [
      ev({ verb: 'project.created', at: at(1), artistId: NOVA, projectId: P1 }),
      rel(2, {}, 'release.created'),
      rel(3, { items: 'added' }),
    ];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('created a project and created the release ‘EP 2027’');
  });

  it('keeps two releases apart, and falls back to the payload title for a deleted one', () => {
    const events = [rel(1, { items: 'added' }), rel(2, { items: 'added' }, 'release.updated', R2), rel(3, { title: 'Old' }, 'release.deleted', '00000000-0000-4000-8000-0000000000e9')];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts).toHaveLength(3);
    expect(describeLine(line, NAMES).text).toBe('edited the tracklist of ‘EP 2027’, edited the tracklist of ‘Singles’ and deleted the release ‘Old’');
  });

  it('names an unknown release neutrally', () => {
    const [line] = buildDigest([rel(1, { items: 'added' }, 'release.updated', '00000000-0000-4000-8000-0000000000ee')], { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('edited the tracklist of a release');
  });
});

describe('buildDigest — artists and org-level events', () => {
  it('attributes a project-only event to the artist the lookup names', () => {
    const events = [ev({ verb: 'file.uploaded', at: '2026-10-05T10:00:00Z', projectId: P1 })];
    const d = buildDigest(events, { view: 'overview', projectArtists: new Map([[P1, [KILO, NOVA]]]) });
    expect(d.sections.map((s) => s.artistId)).toEqual([KILO]);
  });

  it('puts an event with no artist, no project and no match under the organization, last', () => {
    const events = [
      ev({ verb: 'member.joined', at: '2026-10-05T12:00:00Z' }),
      ev({ verb: 'file.uploaded', at: '2026-10-05T10:00:00Z', projectId: P2 }),
      ev({ verb: 'song.created', at: '2026-10-05T09:00:00Z', artistId: NOVA }),
    ];
    const d = buildDigest(events, { view: 'overview', projectArtists: new Map() });
    expect(d.sections.map((s) => s.artistId)).toEqual([NOVA, null]);
    expect(d.sections[1].days[0].lines[0].events).toBe(2);
  });

  it('never invents an actor: a system event has a null actor and a neutral name', () => {
    const [line] = buildDigest([ev({ verb: 'org.created', at: '2026-10-05T10:00:00Z', actorId: null })], { view: 'overview' }).sections[0].days[0].lines;
    expect(line.actorId).toBeNull();
    expect(describeLine(line, NAMES).actor).toBe('Someone');
  });

  it('names an actor without a profile neutrally, never by id', () => {
    const [line] = buildDigest([ev({ verb: 'song.created', at: '2026-10-05T10:00:00Z', actorId: 'unknown-id', artistId: NOVA })], { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).actor).toBe('A team member');
  });
});

describe('buildDigest — the other views', () => {
  const events = [
    ev({ verb: 'song.created', at: '2026-10-05T10:00:00Z', artistId: NOVA, actorId: SAM }),
    ev({ verb: 'song.created', at: '2026-10-05T10:05:00Z', artistId: NOVA, actorId: SAM }),
    ev({ verb: 'file.uploaded', at: '2026-10-04T10:00:00Z', artistId: NOVA, actorId: PRIYA }),
  ];

  it('artist view: one section, day → actor', () => {
    const d = buildDigest(events, { view: 'artist' });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].artistId).toBeNull();
    expect(d.sections[0].days.map((x) => x.day)).toEqual(['2026-10-05', '2026-10-04']);
    expect(d.sections[0].days[0].lines).toHaveLength(1);
  });

  it('project view: day → actor, grouped the same way', () => {
    const d = buildDigest(events, { view: 'project' });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].days[0].lines[0].parts[0]).toMatchObject({ count: 2 });
  });

  it('song view: every event is its own line, newest first (the audit view)', () => {
    const d = buildDigest(events, { view: 'song' });
    const lines = d.sections[0].days.flatMap((x) => x.lines);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.events === 1)).toBe(true);
    expect(lines.map((l) => l.lastAt)).toEqual(['2026-10-05T10:05:00Z', '2026-10-05T10:00:00Z', '2026-10-04T10:00:00Z']);
  });

  it('is empty for no events', () => {
    expect(buildDigest([], { view: 'overview' })).toEqual({ view: 'overview', sections: [], events: 0 });
  });

  it('does not depend on the order events arrive in', () => {
    const a = buildDigest(events, { view: 'overview' });
    const b = buildDigest([...events].reverse(), { view: 'overview' });
    expect(b).toEqual(a);
  });
});

describe('phrases', () => {
  it('lists the phrases in VERBS order, which is the order lines mention the verbs that have no rank of their own', () => {
    expect(Object.keys(VERB_PHRASES)).toEqual([...VERBS]);
  });

  it('has a phrase for every verb, so a new verb forces a decision', () => {
    for (const v of VERBS) {
      expect(VERB_PHRASES[v], v).toBeDefined();
      expect(VERB_PHRASES[v].one.length).toBeGreaterThan(3);
      // A verb that cannot repeat meaningfully (the org is created once) says the same thing for any count.
      expect(VERB_PHRASES[v].many === VERB_PHRASES[v].one || VERB_PHRASES[v].many.includes('{n}'), v).toBe(true);
    }
  });

  it('describes a verb it does not know without throwing', () => {
    expect(describePart({ kind: 'verb', verb: 'song.deleted_forever', count: 2 }, NAMES)).toBe('did song deleted forever');
  });

  it('joins parts with commas and a final "and"', () => {
    const line = {
      key: 'k', actorId: SAM, events: 3, firstAt: 'a', lastAt: 'b', eventIds: [],
      parts: [
        { kind: 'verb' as const, verb: 'song.created', count: 1 },
        { kind: 'verb' as const, verb: 'file.uploaded', count: 2 },
      ],
    };
    expect(describeLine(line, NAMES).text).toBe('added a song and added 2 files');
  });
});

describe('song.stage_changed (LABEL-24)', () => {
  const move = (songId: string, from: string, to: string, at: string, over: Partial<DigestEvent> = {}) =>
    ev({ verb: 'song.stage_changed', at, artistId: NOVA, songId, subjectId: songId, summary: { move: { from, to } }, ...over });
  const lineOf = (events: DigestEvent[], names: DigestNames = NAMES) => describeLine(buildDigest(events, { view: 'overview' }).sections[0].days[0].lines[0], names);

  it('reads "Sam moved Midnight to Selected"', () => {
    const l = lineOf([move(S1, 'in_development', 'selected', '2026-10-05T10:00:00Z')]);
    expect(l).toEqual({ actor: 'Sam', text: 'moved Midnight to Selected' });
  });

  it('collapses several moves of one song by one actor in one day into the first from and the last to', () => {
    const d = buildDigest([
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z'),
      move(S1, 'in_review', 'shortlisted', '2026-10-05T10:00:00Z'),
      move(S1, 'shortlisted', 'in_development', '2026-10-05T11:00:00Z'),
    ], { view: 'overview' });
    const [line] = d.sections[0].days[0].lines;
    expect(line.parts).toEqual([{ kind: 'stage', songId: S1, from: 'inbox', to: 'in_development', moves: 3 }]);
    expect(line.events).toBe(3);
    expect(describeLine(line, NAMES).text).toBe('moved Midnight to In development');
  });

  it('takes the first and last by time, not by arrival order', () => {
    const events = [
      move(S1, 'shortlisted', 'in_development', '2026-10-05T11:00:00Z'),
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z'),
      move(S1, 'in_review', 'shortlisted', '2026-10-05T10:00:00Z'),
    ];
    const [part] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines[0].parts;
    expect(part).toMatchObject({ from: 'inbox', to: 'in_development' });
  });

  it('treats an upper-case id and a lower-case one as one song', () => {
    const events = [
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z'),
      move(S1, 'in_review', 'shortlisted', '2026-10-05T10:00:00Z', { songId: null, subjectId: S1.toUpperCase() }),
    ];
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts).toEqual([{ kind: 'stage', songId: S1, from: 'inbox', to: 'shortlisted', moves: 2 }]);
    expect(describeLine(line, NAMES).text).toBe('moved Midnight to Shortlisted');
  });

  it('keeps two songs apart, and two actors apart', () => {
    const [line] = buildDigest([
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z'),
      move(S2, 'in_review', 'passed', '2026-10-05T10:00:00Z'),
    ], { view: 'overview' }).sections[0].days[0].lines;
    expect(describeLine(line, NAMES).text).toBe('moved Midnight to In review and moved Dawn to Passed');
    const lines = buildDigest([
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z', { actorId: SAM }),
      move(S1, 'in_review', 'passed', '2026-10-05T10:00:00Z', { actorId: PRIYA }),
    ], { view: 'overview' }).sections[0].days[0].lines;
    expect(lines).toHaveLength(2);
  });

  it('does not merge moves on different days', () => {
    const days = buildDigest([
      move(S1, 'inbox', 'in_review', '2026-10-04T09:00:00Z'),
      move(S1, 'in_review', 'shortlisted', '2026-10-05T09:00:00Z'),
    ], { view: 'overview' }).sections[0].days;
    expect(days.map((x) => x.lines[0].parts)).toEqual([
      [{ kind: 'stage', songId: S1, from: 'in_review', to: 'shortlisted', moves: 1 }],
      [{ kind: 'stage', songId: S1, from: 'inbox', to: 'in_review', moves: 1 }],
    ]);
  });

  it('folds a bulk move of many songs into one count, not a list of titles', () => {
    const events = [S1, S2, S3].map((s, i) => move(s, 'inbox', 'passed', `2026-10-05T09:0${i}:00Z`));
    const [line] = buildDigest(events, { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts).toEqual([{ kind: 'verb', verb: 'song.stage_changed', count: 3 }]);
    expect(describeLine(line, NAMES).text).toBe('moved 3 songs to new stages');
  });

  it('says "a song" when the title is unknown, never an id', () => {
    const l = lineOf([move(S3, 'inbox', 'in_review', '2026-10-05T09:00:00Z')]);
    expect(l.text).toBe('moved a song to In review');
    const none = lineOf([move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z')], { actors: { [SAM]: 'Sam' }, artists: {}, releases: {} });
    expect(none.text).toBe('moved a song to In review');
  });

  it('keeps reading an event without a usable { from, to } generically', () => {
    const l = lineOf([ev({ verb: 'song.stage_changed', at: '2026-10-05T09:00:00Z', artistId: NOVA, summary: {} })]);
    expect(l.text).toBe('moved a song to a new stage');
    const bad = lineOf([ev({ verb: 'song.stage_changed', at: '2026-10-05T09:00:00Z', artistId: NOVA, summary: { move: { from: 'inbox', to: 'released' } } })]);
    expect(bad.text).toBe('moved a song to a new stage');
  });

  it('sits after the song was added and before it was reviewed', () => {
    const [line] = buildDigest([
      ev({ verb: 'song.reviewed', at: '2026-10-05T09:03:00Z', artistId: NOVA }),
      move(S1, 'inbox', 'in_review', '2026-10-05T09:02:00Z'),
      ev({ verb: 'song.created', at: '2026-10-05T09:01:00Z', artistId: NOVA, summary: { stage: 'inbox' } }),
    ], { view: 'overview' }).sections[0].days[0].lines;
    expect(line.parts.map((p) => (p.kind === 'verb' ? p.verb : p.kind))).toEqual(['song.created', 'stage', 'song.reviewed']);
  });

  it('song view: every move stays its own line, with its own from and to', () => {
    const lines = buildDigest([
      move(S1, 'inbox', 'in_review', '2026-10-05T09:00:00Z'),
      move(S1, 'in_review', 'shortlisted', '2026-10-05T10:00:00Z'),
    ], { view: 'song' }).sections[0].days[0].lines;
    expect(lines.map((l) => describeLine(l, NAMES).text)).toEqual(['moved Midnight to Shortlisted', 'moved Midnight to In review']);
  });
});
