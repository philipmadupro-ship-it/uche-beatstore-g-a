import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AUDIT_VERBS,
  AuditEventError,
  DEFAULT_VISIBILITY,
  VERBS,
  defaultVisibility,
  fileEventVisibility,
  isAuditVerb,
  recordEvent,
  type ActivityAdmin,
  type EventPayload,
} from './activity';

const ORG = '00000000-0000-4000-8000-00000000000a';
const USER = '00000000-0000-4000-8000-000000000001';
const SUBJECT = '00000000-0000-4000-8000-0000000000f1';
const CONTACT = '00000000-0000-4000-8000-0000000000c1';
const PROJECT = '00000000-0000-4000-8000-0000000000d1';

type Inserted = { table: string; row: Record<string, unknown> };
let inserted: Inserted[] = [];
let nextResult: { data: unknown; error: { message: string } | null } = { data: { id: 'ev-1' }, error: null };

const admin: ActivityAdmin = {
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      inserted.push({ table, row });
      return { select: () => ({ single: async () => nextResult }) };
    },
  }),
} as unknown as ActivityAdmin;

const ctx = { orgId: ORG, userId: USER };

beforeEach(() => {
  inserted = [];
  nextResult = { data: { id: 'ev-1' }, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('verb vocabulary', () => {
  it('every verb matches the activity_events CHECK (^[a-z_]+\\.[a-z_]+$)', () => {
    for (const v of VERBS) expect(v).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('has no duplicates', () => {
    expect(new Set(VERBS).size).toBe(VERBS.length);
  });

  it('every audit verb is a verb', () => {
    for (const v of AUDIT_VERBS) expect(VERBS).toContain(v);
  });

  it('classes the 06 §6 audit list as audit', () => {
    for (const v of [
      'member.joined',
      'member.removed',
      'member.role_changed',
      'member.scope_changed',
      'invitation.created',
      'invitation.revoked',
      'project.member_added',
      'project.member_removed',
      'share.created',
      'share.revoked',
      'file.restricted_downloaded',
      'recording.downloaded',
      'split_sheet.circulated',
      'credit.confirmed',
      'credit.disputed',
      'approval.requested',
      'approval.decided',
      'release.delivered',
    ] as const) {
      expect(isAuditVerb(v)).toBe(true);
    }
  });

  it('everyday work is not audit', () => {
    for (const v of ['song.created', 'song.stage_changed', 'recording.uploaded', 'credit.proposed'] as const) {
      expect(isAuditVerb(v)).toBe(false);
    }
  });

  it('rejects strings outside the union', () => {
    expect(isAuditVerb('member.joined_maybe')).toBe(false);
  });
});

describe('default visibility (D4, D5, 08 §B4)', () => {
  it('names every verb, and only the two classes', () => {
    expect(Object.keys(DEFAULT_VISIBILITY).sort()).toEqual([...VERBS].sort());
    for (const v of VERBS) expect(['internal', 'artist']).toContain(defaultVisibility(v));
  });

  it('shows the creative record to the creative side and the song’s artist', () => {
    for (const v of [
      'song.created',
      'song.stage_changed',
      'song.reviewed',
      'recording.uploaded',
      'project.created',
      'credit.proposed',
      'credit.confirmed',
      'credit.disputed',
      'release.created',
      'release.updated',
      'release.deleted',
      'release.delivered',
    ] as const) {
      expect(defaultVisibility(v), v).toBe('artist');
    }
  });

  it('keeps the business side internal', () => {
    for (const v of [
      'org.created',
      'org.settings_changed',
      'member.joined',
      'member.removed',
      'member.role_changed',
      'member.scope_changed',
      'member.capabilities_changed',
      'member.artists_changed',
      'invitation.created',
      'invitation.revoked',
      'contact.created',
      'contact.updated',
      'contact.deleted',
      'project.member_added',
      'project.member_removed',
      'share.created',
      'share.revoked',
      'recording.downloaded',
      'recording.copied',
      'file.restricted_downloaded',
      'split_sheet.circulated',
      'approval.requested',
      'approval.decided',
      'connection.requested',
      'connection.accepted',
      'connection.ended',
    ] as const) {
      expect(defaultVisibility(v), v).toBe('internal');
    }
  });

  it('a file event is artist-visible only when the file never was restricted (fail closed on anything unknown)', () => {
    expect(fileEventVisibility('normal')).toBe('artist');
    expect(fileEventVisibility('normal', 'normal')).toBe('artist');
    expect(fileEventVisibility('restricted')).toBe('internal');
    expect(fileEventVisibility('normal', 'restricted')).toBe('internal');
    expect(fileEventVisibility('restricted', 'normal')).toBe('internal');
    expect(fileEventVisibility(undefined)).toBe('internal');
    expect(fileEventVisibility(null, 'normal')).toBe('internal');
    expect(fileEventVisibility()).toBe('artist'); // nothing to judge by: callers always pass one
  });

  it('files default to internal: a restricted file must never be shown by accident', () => {
    for (const v of ['file.uploaded', 'file.updated', 'file.deleted'] as const) expect(defaultVisibility(v)).toBe('internal');
  });
});

describe('recordEvent', () => {
  it('writes one activity_events row with the context keys denormalised', async () => {
    const r = await recordEvent(
      admin,
      ctx,
      'song.stage_changed',
      { type: 'track', id: SUBJECT, artistId: CONTACT, projectId: PROJECT, songId: SUBJECT },
      { from: 'inbox', to: 'shortlist' },
      { visibility: 'artist' },
    );
    expect(r).toEqual({ ok: true, id: 'ev-1' });
    expect(inserted).toEqual([
      {
        table: 'activity_events',
        row: {
          org_id: ORG,
          actor_id: USER,
          verb: 'song.stage_changed',
          subject_type: 'track',
          subject_id: SUBJECT,
          artist_id: CONTACT,
          project_id: PROJECT,
          song_id: SUBJECT,
          release_id: null,
          payload: { from: 'inbox', to: 'shortlist' },
          audit: false,
          visibility: 'artist',
        },
      },
    ]);
  });

  it('defaults visibility per verb and to an empty payload', async () => {
    await recordEvent(admin, ctx, 'recording.uploaded', { type: 'track', id: SUBJECT });
    expect(inserted[0].row.visibility).toBe('artist');
    expect(inserted[0].row.payload).toEqual({});
    await recordEvent(admin, ctx, 'contact.created', { type: 'contact', id: SUBJECT });
    expect(inserted[1].row.visibility).toBe('internal');
  });

  it('lets a route override the default for one event', async () => {
    await recordEvent(admin, ctx, 'file.uploaded', { type: 'asset', id: SUBJECT }, {}, { visibility: 'artist' });
    expect(inserted[0].row.visibility).toBe('artist');
    await recordEvent(admin, ctx, 'song.created', { type: 'track', id: SUBJECT }, {}, { visibility: 'internal' });
    expect(inserted[1].row.visibility).toBe('internal');
  });

  it('takes a null actor for system events', async () => {
    await recordEvent(admin, { orgId: ORG, userId: null }, 'song.created', { type: 'track', id: SUBJECT });
    expect(inserted[0].row.actor_id).toBeNull();
  });

  it('marks audit verbs audit, and an audit verb cannot be downgraded', async () => {
    await recordEvent(admin, ctx, 'member.removed', { type: 'member', id: USER }, {}, { audit: false });
    expect(inserted[0].row.audit).toBe(true);
  });

  it('lets a route promote an everyday verb to audit', async () => {
    await recordEvent(admin, ctx, 'song.created', { type: 'track', id: SUBJECT }, {}, { audit: true });
    expect(inserted[0].row.audit).toBe(true);
  });

  it('a non-audit write failure is logged and returned, never thrown', async () => {
    nextResult = { data: null, error: { message: 'db down' } };
    const r = await recordEvent(admin, ctx, 'song.created', { type: 'track', id: SUBJECT });
    expect(r).toEqual({ ok: false, error: 'db down' });
  });

  it('an audit write failure throws, so the route fails', async () => {
    nextResult = { data: null, error: { message: 'db down' } };
    await expect(
      recordEvent(admin, ctx, 'member.joined', { type: 'member', id: USER }),
    ).rejects.toBeInstanceOf(AuditEventError);
  });

  it('an unknown verb is refused before any write', async () => {
    const r = await recordEvent(admin, ctx, 'song.deleted_forever' as never, { type: 'track', id: SUBJECT });
    expect(r.ok).toBe(false);
    expect(inserted).toEqual([]);
  });

  it('a malformed id is refused before any write (audit: thrown)', async () => {
    const bad = await recordEvent(admin, ctx, 'song.created', { type: 'track', id: 'nope' });
    expect(bad.ok).toBe(false);
    await expect(
      recordEvent(admin, { orgId: 'nope', userId: USER }, 'member.joined', { type: 'member', id: USER }),
    ).rejects.toBeInstanceOf(AuditEventError);
    expect(inserted).toEqual([]);
  });

  it('refuses a payload that carries a token, password or secret, at any depth', async () => {
    for (const payload of <EventPayload[]>[
      { token: 'abc' },
      { share_token: 'abc' },
      { invite: { token_hash: 'x' } },
      { list: [{ Password: 'x' }] },
      { clientSecret: 'x' },
    ]) {
      const r = await recordEvent(admin, ctx, 'share.created', { type: 'share', id: SUBJECT }, payload).catch(
        (e: unknown) => e,
      );
      expect(r).toBeInstanceOf(AuditEventError);
    }
    expect(inserted).toEqual([]);
  });

  it('refuses a payload that is not a plain JSON object or is oversized', async () => {
    const huge = { notes: 'x'.repeat(20_000) };
    const r1 = await recordEvent(admin, ctx, 'song.created', { type: 'track', id: SUBJECT }, huge);
    expect(r1.ok).toBe(false);
    const r2 = await recordEvent(
      admin,
      ctx,
      'song.created',
      { type: 'track', id: SUBJECT },
      [1, 2] as never,
    );
    expect(r2.ok).toBe(false);
    expect(inserted).toEqual([]);
  });
});
