import { describe, expect, it, vi } from 'vitest';
import { addTracksToCollection, collectSummary, collectionHref } from './collect-selection';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('addTracksToCollection', () => {
  it('creates a playlist then adds the tracks (deduped)', async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => json({ playlist: { id: 'pl1' } }))
      .mockImplementationOnce(() => json({ added: 2 }));
    const r = await addTracksToCollection({ kind: 'playlist', existingId: null, name: ' Night ' }, ['a', 'b', 'a'], f as never);
    expect(r).toEqual({ kind: 'playlist', id: 'pl1', created: true, added: 2, skipped: 0 });
    expect(f.mock.calls[0][0]).toBe('/api/playlists');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: 'Night' });
    expect(f.mock.calls[1][0]).toBe('/api/playlists/pl1/tracks');
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ track_ids: ['a', 'b'] });
  });

  it('adds to an existing project without creating one', async () => {
    const f = vi.fn().mockImplementationOnce(() => json({ added: 1, skipped: 2 }));
    const r = await addTracksToCollection({ kind: 'project', existingId: 'pr9', name: 'ignored' }, ['a', 'b', 'c'], f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/api/projects/pr9/tracks');
    expect(r).toMatchObject({ created: false, added: 1, skipped: 2 });
  });

  it('refuses an empty selection before any request', async () => {
    const f = vi.fn();
    await expect(addTracksToCollection({ kind: 'project', existingId: null, name: '' }, [], f as never)).rejects.toThrow(/at least one/);
    expect(f).not.toHaveBeenCalled();
  });

  it('surfaces the server error and does not add when create fails', async () => {
    const f = vi.fn().mockImplementationOnce(() => json({ error: 'nope' }, 500));
    await expect(addTracksToCollection({ kind: 'project', existingId: null, name: 'x' }, ['a'], f as never)).rejects.toThrow('nope');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports a failed add', async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => json({ project: { id: 'p' } }))
      .mockImplementationOnce(() => json({}, 403));
    await expect(addTracksToCollection({ kind: 'project', existingId: null, name: 'x' }, ['a'], f as never)).rejects.toThrow(/403/);
  });

  it('rejects a create response with no id', async () => {
    const f = vi.fn().mockImplementationOnce(() => json({ playlist: {} }));
    await expect(addTracksToCollection({ kind: 'playlist', existingId: null, name: 'x' }, ['a'], f as never)).rejects.toThrow(/without an id/);
  });
});

describe('collect helpers', () => {
  it('links to the right page', () => {
    expect(collectionHref('playlist', 'x')).toBe('/playlists/x');
    expect(collectionHref('project', 'x')).toBe('/projects/x');
  });
  it('summary names skips', () => {
    const s = collectSummary({ kind: 'project', id: 'p', created: false, added: 1, skipped: 2 }, 'Demo');
    expect(s.title).toBe('Added to project');
    expect(s.description).toContain('1 track added to Demo');
    expect(s.description).toContain('2 already there');
  });
});
