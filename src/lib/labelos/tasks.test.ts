import { describe, expect, it } from 'vitest';
import {
  assigneeToNotify,
  canSeeTask,
  groupOpenTasks,
  holdsEverything,
  mayChangeTask,
  mayCreateTask,
  mayDeleteTask,
  parseTarget,
  sortTasks,
  targetColumns,
  targetHref,
  targetOfRow,
  toTaskView,
  type TaskRow,
} from './tasks';
import { ALL_CAPABILITIES, ORG_FUNCTIONS, capabilitiesFor } from './capabilities';

const U = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = U(1);
const YOU = U(2);
const OTHER = U(3);
const ID = '50000000-0000-4000-8000-000000000001';

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1', title: 'Clear the sample', notes: null, dueAt: null, doneAt: null, assigneeId: YOU, createdBy: ME, target: null, createdAt: '2026-10-01T10:00:00Z', ...over,
});

describe('targets: at most one object', () => {
  it('sets exactly one typed column, lower-cased, and nulls the rest', () => {
    expect(targetColumns({ kind: 'song', id: ID.toUpperCase() })).toEqual({ artist_id: null, project_id: null, song_id: ID, release_id: null });
    expect(targetColumns({ kind: 'artist', id: ID })).toEqual({ artist_id: ID, project_id: null, song_id: null, release_id: null });
    expect(targetColumns({ kind: 'project', id: ID }).project_id).toBe(ID);
    expect(targetColumns({ kind: 'release', id: ID }).release_id).toBe(ID);
    expect(targetColumns(null)).toEqual({ artist_id: null, project_id: null, song_id: null, release_id: null });
  });

  it('every target round-trips through the row columns', () => {
    for (const kind of ['artist', 'project', 'song', 'release'] as const) {
      expect(targetOfRow(targetColumns({ kind, id: ID }))).toEqual({ kind, id: ID });
    }
    expect(targetOfRow(targetColumns(null))).toBeNull();
  });

  it('a row naming two objects (impossible under the CHECK) reads as none — never picks one', () => {
    expect(targetOfRow({ artist_id: ID, project_id: ID, song_id: null, release_id: null })).toBeNull();
  });

  it('parses loose input: nothing → null; malformed → undefined', () => {
    expect(parseTarget(null)).toBeNull();
    expect(parseTarget({})).toBeNull();
    expect(parseTarget({ kind: 'song', id: ID })).toEqual({ kind: 'song', id: ID });
    expect(parseTarget({ kind: 'song' })).toBeUndefined();
    expect(parseTarget({ kind: 'beat', id: ID })).toBeUndefined();
    expect(parseTarget({ kind: 'song', id: 'nope' })).toBeUndefined();
  });

  it('links a task to its object page; a release has none yet', () => {
    expect(targetHref('night-shift', { kind: 'song', id: ID })).toBe(`/o/night-shift/songs/${ID}`);
    expect(targetHref('night-shift', { kind: 'artist', id: ID })).toBe(`/o/night-shift/artists/${ID}`);
    expect(targetHref('night-shift', { kind: 'project', id: ID })).toBe(`/o/night-shift/projects/${ID}`);
    expect(targetHref('night-shift', { kind: 'release', id: ID })).toBeNull();
    expect(targetHref('night-shift', null)).toBeNull();
  });
});

describe('who sees and changes a task (D1: each side its own)', () => {
  const t = task();
  it('its maker, its assignee and an owner/admin see it; nobody else does', () => {
    expect(canSeeTask(t, { userId: ME, role: 'member' })).toBe(true);
    expect(canSeeTask(t, { userId: YOU, role: 'member' })).toBe(true);
    expect(canSeeTask(t, { userId: OTHER, role: 'owner' })).toBe(true);
    expect(canSeeTask(t, { userId: OTHER, role: 'admin' })).toBe(true);
    expect(canSeeTask(t, { userId: OTHER, role: 'member' })).toBe(false);
    expect(canSeeTask(t, { userId: OTHER, role: 'artist' })).toBe(false);
  });

  it('compares ids case-insensitively', () => {
    expect(canSeeTask(task({ assigneeId: YOU.toUpperCase() }), { userId: YOU, role: 'member' })).toBe(true);
  });

  it('an unassigned task is seen only by its maker (and owner/admin)', () => {
    const open = task({ assigneeId: null });
    expect(canSeeTask(open, { userId: YOU, role: 'member' })).toBe(false);
    expect(canSeeTask(open, { userId: ME, role: 'member' })).toBe(true);
  });

  it('the assignee may tick it off but not delete it', () => {
    expect(mayChangeTask(t, { userId: YOU, role: 'member' })).toBe(true);
    expect(mayDeleteTask(t, { userId: YOU, role: 'member' })).toBe(false);
    expect(mayDeleteTask(t, { userId: ME, role: 'member' })).toBe(true);
    expect(mayDeleteTask(t, { userId: OTHER, role: 'admin' })).toBe(true);
  });

  it('a member whose maker left (created_by null) cannot be mistaken for the maker', () => {
    expect(mayDeleteTask(task({ createdBy: null }), { userId: YOU, role: 'member' })).toBe(false);
  });

  it('owner and admin are exactly the roles that hold everything', () => {
    expect(['owner', 'admin', 'member', 'artist'].filter((r) => holdsEverything(r as never))).toEqual(['owner', 'admin']);
  });

  it('every function column that exists holds tasks.write (15 D1) — except the two deferred ones', () => {
    const withWrite = ORG_FUNCTIONS.filter((fn) => mayCreateTask(capabilitiesFor('label', 'member', [fn])));
    expect(withWrite).toEqual(ORG_FUNCTIONS.filter((fn) => fn !== 'finance' && fn !== 'operations'));
    expect(ALL_CAPABILITIES).toContain('tasks.write');
    // A roster artist has none.
    expect(mayCreateTask(capabilitiesFor('label', 'artist', []))).toBe(false);
  });
});

describe('who is asked (only the new assignee, once, never yourself)', () => {
  it('a task handed to someone else asks them', () => {
    expect(assigneeToNotify({ actorId: ME, before: null, after: YOU })).toBe(YOU);
    expect(assigneeToNotify({ actorId: ME, before: OTHER, after: YOU })).toBe(YOU);
  });
  it('nobody is asked when the assignee is yourself, unchanged, or cleared', () => {
    expect(assigneeToNotify({ actorId: ME, before: null, after: ME })).toBeNull();
    expect(assigneeToNotify({ actorId: ME, before: YOU, after: YOU })).toBeNull();
    expect(assigneeToNotify({ actorId: ME, before: YOU, after: null })).toBeNull();
    expect(assigneeToNotify({ actorId: ME, before: YOU, after: YOU.toUpperCase() })).toBeNull();
  });
});

describe('lists', () => {
  it('sorts open before done, soonest due first, undated last', () => {
    const list = [
      task({ id: 'done', doneAt: '2026-10-05T00:00:00Z' }),
      task({ id: 'later', dueAt: '2026-10-20T00:00:00Z' }),
      task({ id: 'nodate', createdAt: '2026-10-03T00:00:00Z' }),
      task({ id: 'soon', dueAt: '2026-10-08T00:00:00Z' }),
    ];
    expect(sortTasks(list).map((x) => x.id)).toEqual(['soon', 'later', 'nodate', 'done']);
  });

  it('groups My work overdue → today → upcoming → no date, leaving empty groups and done tasks out', () => {
    const now = new Date('2026-10-06T12:00:00').getTime();
    const list = [
      task({ id: 'a', dueAt: '2026-10-01T09:00:00' }),
      task({ id: 'b', dueAt: '2026-10-06T18:00:00' }),
      task({ id: 'c', dueAt: '2026-10-12T09:00:00' }),
      task({ id: 'd' }),
      task({ id: 'e', doneAt: '2026-10-05T00:00:00Z', dueAt: '2026-10-01T09:00:00' }),
    ];
    const groups = groupOpenTasks(list, now);
    expect(groups.map((g) => [g.bucket, g.tasks.map((x) => x.id)])).toEqual([
      ['overdue', ['a']],
      ['today', ['b']],
      ['upcoming', ['c']],
      ['someday', ['d']],
    ]);
    expect(groupOpenTasks([], now)).toEqual([]);
  });
});

describe('the API shape', () => {
  it('is built field by field, names never emails, and carries what the viewer may do', () => {
    const names = new Map([[ME, 'Sam'], [YOU, 'Ada']]);
    const v = toTaskView(task(), names, { userId: YOU, role: 'member' });
    expect(v).toEqual({
      id: 't1', title: 'Clear the sample', notes: null, dueAt: null, doneAt: null,
      assignee: { id: YOU, name: 'Ada' }, createdBy: { id: ME, name: 'Sam' }, target: null, createdAt: '2026-10-01T10:00:00Z',
      mine: true, canChange: true, canDelete: false,
    });
    expect(JSON.stringify(v)).not.toMatch(/@/);
    expect(toTaskView(task({ assigneeId: null }), names, { userId: ME, role: 'member' }).assignee).toBeNull();
  });
});
