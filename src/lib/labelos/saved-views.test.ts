import { describe, expect, it } from 'vitest';
import {
  canSee,
  hiddenFrom,
  orderViews,
  planChange,
  planDelete,
  planSave,
  toViewDto,
  type ViewActor,
  type ViewRow,
} from './saved-views';
import { exampleQueries, sanitizeDefinition, type Definition } from './filters';

const U1 = '10000000-0000-4000-8000-000000000001';
const U2 = '10000000-0000-4000-8000-000000000002';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [producedBy, , missingArtwork, waitingLegal] = exampleQueries({ producer: id(1), artistA: id(2), featured: id(3) }, 2026).map((q) => q.definition);

const actor = (userId: string, role: string, caps: string[]): ViewActor => ({ userId, role, capabilities: new Set(caps) });
const writer = actor(U1, 'member', ['catalog.read', 'catalog.write', 'rights.read']);
const reader = actor(U2, 'member', ['catalog.read']);
const admin = actor(U2, 'admin', ['catalog.read', 'catalog.write', 'rights.read']);

const row = (extra: Partial<ViewRow> = {}): ViewRow => ({
  id: id(50), org_id: id(60), created_by: U1, subject: 'songs', name: 'Needs art', definition: missingArtwork, shared: false, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});

describe('saving', () => {
  it('a personal view needs only the data’s own capability', () => {
    expect(planSave(reader, { shared: false, definition: missingArtwork }, false)).toEqual({ ok: true });
  });
  it('sharing with the org needs catalog.write', () => {
    expect(planSave(reader, { shared: true, definition: missingArtwork }, false)).toMatchObject({ ok: false, status: 403 });
    expect(planSave(writer, { shared: true, definition: missingArtwork }, false)).toEqual({ ok: true });
  });
  it('a view the saver could not run is refused', () => {
    expect(planSave(reader, { shared: false, definition: producedBy }, false)).toMatchObject({ ok: false, status: 403, error: expect.stringContaining('credits') });
    expect(planSave(writer, { shared: false, definition: producedBy }, false)).toEqual({ ok: true });
    expect(planSave(writer, { shared: false, definition: waitingLegal }, false)).toMatchObject({ ok: false, status: 403 });
    expect(planSave(writer, { shared: false, definition: waitingLegal }, true)).toEqual({ ok: true });
  });
});

describe('seeing, changing, deleting', () => {
  it('a personal view is unknown to everyone but its author (404, not 403)', () => {
    const mine = row();
    expect(canSee(mine, writer)).toBe(true);
    expect(canSee(mine, reader)).toBe(false);
    expect(planChange(mine, reader, { name: 'x' }, false)).toMatchObject({ ok: false, status: 404 });
    expect(planDelete(mine, reader)).toMatchObject({ ok: false, status: 404 });
    // not even an admin reads or removes somebody's personal view
    expect(planChange(mine, admin, { shared: false }, false)).toMatchObject({ ok: false, status: 404 });
    expect(planDelete(mine, admin)).toMatchObject({ ok: false, status: 404 });
  });
  it('the author changes and deletes their own; sharing it needs catalog.write', () => {
    expect(planChange(row(), writer, { name: 'x', definition: missingArtwork as Definition }, false)).toEqual({ ok: true });
    expect(planChange(row(), actor(U1, 'member', ['catalog.read']), { shared: true }, false)).toMatchObject({ ok: false, status: 403 });
    expect(planChange(row({ shared: true }), actor(U1, 'member', ['catalog.read']), { shared: false }, false)).toEqual({ ok: true });
    expect(planDelete(row(), writer)).toEqual({ ok: true });
  });
  it('someone else’s shared view: readers can run it, not change or delete it', () => {
    const shared = row({ shared: true });
    expect(canSee(shared, reader)).toBe(true);
    expect(planChange(shared, reader, { name: 'x' }, false)).toMatchObject({ ok: false, status: 403 });
    expect(planDelete(shared, reader)).toMatchObject({ ok: false, status: 403 });
  });
  it('an owner or admin can take a shared view down, not rewrite it', () => {
    const shared = row({ shared: true });
    expect(planDelete(shared, admin)).toEqual({ ok: true });
    expect(planChange(shared, admin, { shared: false }, false)).toEqual({ ok: true });
    expect(planChange(shared, admin, { name: 'mine now' }, false)).toMatchObject({ ok: false, status: 403 });
    expect(planChange(shared, admin, { shared: false, definition: missingArtwork }, false)).toMatchObject({ ok: false, status: 403 });
  });
  it('a change to rights clauses is checked against the author’s role again', () => {
    expect(planChange(row(), actor(U1, 'member', ['catalog.read']), { definition: producedBy }, false)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('what a viewer is shown', () => {
  const nova = id(2);
  const withArtist: Definition = { v: 1, subject: 'songs', filter: { artistIds: [nova], missing: ['artwork'] } };

  it('a shared view that refers to anything outside the viewer’s reach is hidden from them entirely', () => {
    const shared = row({ shared: true, definition: withArtist });
    const seen = sanitizeDefinition(withArtist, { artists: new Set([id(9)]), parties: new Set(), projects: new Set() });
    expect(seen.narrowed).toBe(true);
    expect(hiddenFrom(shared, reader, seen.narrowed)).toBe(true);
    // …but not from its author, and not from someone who can see every artist it names
    expect(hiddenFrom(shared, writer, seen.narrowed)).toBe(false);
    const all = sanitizeDefinition(withArtist, { artists: null, parties: null, projects: null });
    expect(hiddenFrom(shared, reader, all.narrowed)).toBe(false);
  });
  it('a personal view is hidden from everyone but its author', () => {
    expect(hiddenFrom(row(), reader, false)).toBe(true);
    expect(hiddenFrom(row(), writer, false)).toBe(false);
  });
  it('the dto never carries the dropped ids, and says what the viewer may do', () => {
    const shared = row({ shared: true, definition: withArtist });
    const seen = sanitizeDefinition(withArtist, { artists: new Set(), parties: new Set(), projects: new Set() });
    const dto = toViewDto(shared, admin, seen, 'Una');
    expect(JSON.stringify(dto)).not.toContain(nova);
    expect(dto).toMatchObject({ mine: false, author: 'Una', canEdit: false, canDelete: true, canUnshare: true, narrowed: true });
    const own = toViewDto(row(), writer, { definition: missingArtwork, narrowed: false }, 'Una');
    expect(own).toMatchObject({ mine: true, author: null, canEdit: true, canDelete: true, canUnshare: false });
    expect(toViewDto(row({ shared: true }), reader, { definition: missingArtwork, narrowed: false }, 'Una')).toMatchObject({ canDelete: false, canUnshare: false });
  });
  it('mine first, then by name', () => {
    const list = orderViews([
      { id: 'c', name: 'zeta', mine: false },
      { id: 'b', name: 'Beta', mine: true },
      { id: 'a', name: 'alpha', mine: true },
      { id: 'd', name: 'Alpha', mine: false },
    ]);
    expect(list.map((v) => v.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
