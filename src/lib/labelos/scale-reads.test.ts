/**
 * G6 review: reads that must survive PostgREST's `max-rows` (1000) and its URL
 * length limit. Three Label OS reads built a whole list with one unpaged,
 * unchunked select, so past a catalogue's first thousand rows they answered a
 * silently short list — a scoped member lost parties, and the A&R inbox lost
 * songs and reviews — with no error to say so.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AdminClient } from '@/lib/auth/ownership';
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { listParties, scopedPartyIds } from './credits-store';
import { loadArInbox } from './ar-inbox-store';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';

const ORG = '11111111-1111-4111-8111-111111111111';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

const admin = (db: MemoryDb) => memoryAdmin(db).client as unknown as AdminClient;

describe('scale: reads past PostgREST max-rows', () => {
  it('scopedPartyIds finds a party credited beyond the first 1000 credits of the scope', async () => {
    const tracks = Array.from({ length: 1200 }, () => randomUUID());
    const parties = tracks.map((_, i) => ({ id: randomUUID(), org_id: ORG, display_name: `P${String(i).padStart(4, '0')}` }));
    const db: MemoryDb = {
      maxRows: 1000,
      tables: {
        projects: [{ id: PROJECT, org_id: ORG, inbox_for_contact_id: ARTIST }],
        project_contacts: [],
        project_tracks: tracks.map((track_id, i) => ({ project_id: PROJECT, track_id, position: i })),
        // One credit per song, each a different party: 1200 credits, the cap is 1000.
        track_collaborators: tracks.map((track_id, i) => ({ id: randomUUID(), org_id: ORG, track_id, party_id: parties[i].id })),
      },
    };
    const ctx = { orgId: ORG, userId: USER, scope: 'artists', artistScope: new Set([ARTIST]) } as unknown as OrgAccessOk;
    const ids = await scopedPartyIds(admin(db), ctx);
    expect(new Set(ids).size).toBe(1200);
  });

  it('listParties returns every party of an org with more than 1000', async () => {
    const db: MemoryDb = {
      maxRows: 1000,
      tables: { parties: Array.from({ length: 1300 }, (_, i) => ({ id: randomUUID(), org_id: ORG, display_name: `P${String(i).padStart(4, '0')}` })) },
    };
    expect(await listParties(admin(db), ORG)).toHaveLength(1300);
  });

  it('the A&R inbox lists every inbox song of a whole-org member past 1000', async () => {
    const songs = Array.from({ length: 1100 }, (_, i) => ({
      id: randomUUID(),
      org_id: ORG,
      type: 'song',
      song_stage: 'inbox',
      title: `S${i}`,
      cover_url: null,
      bpm: null,
      key: null,
      duration_seconds: null,
      audio_url: 'r2://private/orgs/x/a',
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    const db: MemoryDb = {
      maxRows: 1000,
      tables: { tracks: songs, track_links: [], song_beats: [], project_tracks: [], projects: [], contacts: [], song_reviews: [], project_contacts: [] },
    };
    const caps = new Set(['catalog.read', 'catalog.write', 'audio.finished', 'audio.working', 'review.write', 'review.comment']);
    const access = { admin: admin(db), orgId: ORG, userId: USER, artistScope: null, capabilities: caps } as unknown as OrgAccessOk;
    const inbox = await loadArInbox(access);
    expect(inbox.songs.length + inbox.restricted).toBe(1100);
  });
});
