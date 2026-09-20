import { describe, expect, it, vi } from 'vitest';

import { persistTrackCollaborators } from './collaborators';
import type { Collaborator } from './title-metadata';

type Call = { table: string; op: 'insert' | 'delete'; payload?: unknown; eqs?: unknown[][] };

/** A Supabase stand-in that records calls and can be told to fail either op. */
function makeClient(fail?: { insert?: string; delete?: string }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      return {
        insert(rows: unknown[]) {
          calls.push({ table, op: 'insert', payload: rows });
          return Promise.resolve({
            error: fail?.insert ? { message: fail.insert } : null,
          });
        },
        delete() {
          const eqs: unknown[][] = [];
          const chain = {
            eq(column: string, value: unknown) {
              eqs.push([column, value]);
              if (eqs.length === 2) {
                calls.push({ table, op: 'delete', eqs });
                return Promise.resolve({
                  error: fail?.delete ? { message: fail.delete } : null,
                });
              }
              return chain;
            },
          };
          return chain as never;
        },
      };
    },
  };
  return { client, calls };
}

const credits: Collaborator[] = [
  { name: 'Wheezy', role: 'producer' },
  { name: 'Ayo', role: 'feature' },
];

describe('persistTrackCollaborators', () => {
  it('replaces the previous filename credits, then inserts the new ones', async () => {
    const { client, calls } = makeClient();
    const saved = await persistTrackCollaborators(client, 'track-1', credits);

    expect(saved).toBe(2);
    expect(calls.map((c) => c.op)).toEqual(['delete', 'insert']);
    expect(calls[1].payload).toEqual([
      { track_id: 'track-1', name: 'Wheezy', role: 'producer', source: 'filename' },
      { track_id: 'track-1', name: 'Ayo', role: 'feature', source: 'filename' },
    ]);
  });

  it('only ever clears rows it wrote itself', async () => {
    // A credit the producer typed must survive a re-parse of the filename.
    const { client, calls } = makeClient();
    await persistTrackCollaborators(client, 'track-1', credits);
    expect(calls[0].eqs).toEqual([
      ['track_id', 'track-1'],
      ['source', 'filename'],
    ]);
  });

  it('clears stale credits even when the new name has none', async () => {
    const { client, calls } = makeClient();
    const saved = await persistTrackCollaborators(client, 'track-1', []);
    expect(saved).toBe(0);
    expect(calls.map((c) => c.op)).toEqual(['delete']);
  });

  it('does nothing without a track id', async () => {
    const { client, calls } = makeClient();
    expect(await persistTrackCollaborators(client, '', credits)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('never throws when the table is missing, so the upload still completes', async () => {
    // Migration 115 not applied yet.
    const { client } = makeClient({ delete: 'relation "track_collaborators" does not exist' });
    await expect(persistTrackCollaborators(client, 'track-1', credits)).resolves.toBe(0);
  });

  it('reports nothing saved when the insert is rejected', async () => {
    // supabase-js resolves with `{ error }` rather than throwing, so a bare
    // try/catch would report success here.
    const { client } = makeClient({ insert: 'permission denied' });
    await expect(persistTrackCollaborators(client, 'track-1', credits)).resolves.toBe(0);
  });

  it('does not attempt the insert when the delete failed', async () => {
    const { client, calls } = makeClient({ delete: 'boom' });
    await persistTrackCollaborators(client, 'track-1', credits);
    expect(calls.map((c) => c.op)).toEqual(['delete']);
  });
});

describe('logging', () => {
  it('warns rather than throwing on failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeClient({ insert: 'nope' });
    await persistTrackCollaborators(client, 'track-1', credits);
    warn.mockRestore();
  });
});
