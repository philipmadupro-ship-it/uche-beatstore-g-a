import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { proposeCollaboratorCredit } from './collaborator-accept-store';
import { hashInvitationToken } from './invitations';

const ORG = '10000000-0000-4000-8000-000000000001';
const INVITER = '20000000-0000-4000-8000-000000000001';
const GUEST = '20000000-0000-4000-8000-000000000009';
const PROJECT = '40000000-0000-4000-8000-0000000000a1';
const SONG = '50000000-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(43);

let mem: ReturnType<typeof memoryAdmin>;
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

let db: MemoryDb;
const run = () => (mem = memoryAdmin(db), proposeCollaboratorCredit(mem.client as never, { tokenHash: hashInvitationToken(TOKEN), orgId: ORG, projectId: PROJECT, userId: GUEST }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  db = {
    tables: {
      organizations: [{ id: ORG, name: 'Night Shift', kind: 'label', deleted_at: null }],
      org_members: [{ org_id: ORG, user_id: INVITER, role: 'owner', functions: [], scope: 'org', cap_grants: [], cap_revokes: [] }],
      org_invitations: [
        { id: 'i1', org_id: ORG, email: 'rap.guest@local.test', role: 'member', functions: ['collab:rapper', `song:${SONG}`], project_id: PROJECT, project_role: 'contributor', token_hash: hashInvitationToken(TOKEN), invited_by: INVITER, accepted_at: new Date().toISOString() },
      ],
      project_tracks: [{ project_id: PROJECT, track_id: SONG }],
      tracks: [{ id: SONG, org_id: ORG, title: 'Midnight', type: 'song' }],
      parties: [],
      track_collaborators: [],
      user_profiles: [],
      creator_profiles: [],
      activity_events: [],
    },
  };
});

describe('proposeCollaboratorCredit', () => {
  it('proposes the matching credit for the invitee’s own party, in the inviter’s name', async () => {
    const r = await run();
    expect(r.proposed).toBe(true);
    expect(db.tables.parties).toHaveLength(1);
    expect(db.tables.parties[0]).toMatchObject({ org_id: ORG, user_id: GUEST, display_name: 'rap.guest' });
    expect(db.tables.track_collaborators[0]).toMatchObject({
      track_id: SONG, org_id: ORG, role: 'vocalist', role_detail: 'Rap', scope: 'recording', status: 'proposed', party_id: db.tables.parties[0].id, created_by: INVITER,
    });
  });

  it('the collaborator did not propose it themselves, so they are the one who can confirm it', async () => {
    await run();
    expect(db.tables.track_collaborators[0].created_by).not.toBe(GUEST);
  });

  it('reuses an existing party of that account', async () => {
    db.tables.parties.push({ id: 'p9', org_id: ORG, kind: 'person', display_name: 'Rhyme', user_id: GUEST });
    await run();
    expect(db.tables.parties).toHaveLength(1);
    expect(db.tables.track_collaborators[0].party_id).toBe('p9');
  });

  it('writes nothing when the inviter lost rights.write, or the song left the project', async () => {
    db.tables.org_members[0].role = 'member';
    db.tables.org_members[0].functions = ['marketing'];
    expect(await run()).toEqual({ proposed: false, reason: 'inviter_gone' });
    db.tables.org_members[0].role = 'owner';
    db.tables.project_tracks.length = 0;
    expect(await run()).toEqual({ proposed: false, reason: 'song_not_in_project' });
    expect(db.tables.track_collaborators).toHaveLength(0);
  });

  it('follows the invitation being accepted now — also when the person was already on the project', async () => {
    // (The accept function answers `already_member` for them; the route still calls this.)
    expect((await run()).proposed).toBe(true);
  });

  it('a spent link opened again later proposes nothing, so a withdrawn credit stays withdrawn', async () => {
    db.tables.org_invitations[0].accepted_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(await run()).toEqual({ proposed: false, reason: 'not_fresh' });
    expect(db.tables.track_collaborators).toHaveLength(0);
  });

  it('is refused when the inviter can no longer reach the song: the licence, or an artist scope that excludes it', async () => {
    db.tables.org_members[0].scope = 'artists'; // scoped to nobody
    db.tables.org_members[0].role = 'member';
    db.tables.org_members[0].functions = ['legal'];
    expect(await run()).toEqual({ proposed: false, reason: 'inviter_gone' });
    expect(db.tables.track_collaborators).toHaveLength(0);
  });

  it('an ordinary invitation proposes nothing', async () => {
    db.tables.org_invitations[0].functions = [];
    expect(await run()).toEqual({ proposed: false, reason: 'no_intent' });
  });

  it('never throws: a database that errors leaves the person admitted with nothing proposed', async () => {
    const broken = { from: () => { throw new Error('relation does not exist'); } };
    const r = await proposeCollaboratorCredit(broken as never, { tokenHash: hashInvitationToken(TOKEN), orgId: ORG, projectId: PROJECT, userId: GUEST });
    expect(r).toEqual({ proposed: false, reason: 'failed' });
  });
});
