import { describe, expect, it } from 'vitest';
import {
  ORG_UPLOAD_RELATIONS,
  isAnyOrgUploadKey,
  isOrgMasterRef,
  isOrgUploadKey,
  isPrivateOrgMediaRef,
  orgMediaKey,
  orgUploadKeyPrefix,
  orgUploadTrackFields,
  orgUploadTrackView,
  orgUploadPlayUrl,
} from './org-upload';
import { OrgUploadCompleteSchema, OrgUploadInitSchema } from '@/lib/contracts';
import { recordingContexts } from './org-audio';

const ORG = 'B1410000-0000-4000-8000-000000000001';
const org = ORG.toLowerCase();
const OTHER = 'b1410000-0000-4000-8000-000000000002';

describe('org upload keys', () => {
  it('puts an org master under orgs/<org>/tracks, lowercased', () => {
    expect(orgUploadKeyPrefix(ORG)).toBe(`orgs/${org}/tracks`);
  });

  it('binds a session to its org through the object key (R2 and the local fallback)', () => {
    expect(isOrgUploadKey(`orgs/${org}/tracks/abc.wav`, ORG)).toBe(true);
    expect(isOrgUploadKey(`local:orgs/${org}/tracks/sid123`, ORG)).toBe(true);
    expect(isOrgUploadKey(`orgs/${OTHER}/tracks/abc.wav`, ORG)).toBe(false);
    expect(isOrgUploadKey('tracks/abc.wav', ORG)).toBe(false);
    expect(isOrgUploadKey('local:sid123', ORG)).toBe(false);
    // A prefix trick: the org id must be a whole path segment.
    expect(isOrgUploadKey(`orgs/${org}x/tracks/abc.wav`, ORG)).toBe(false);
    expect(isOrgUploadKey(`orgs/${org}/tracks/../../tracks/abc.wav`, ORG)).toBe(false);
  });

  it('tells a producer route an org session apart from its own', () => {
    expect(isAnyOrgUploadKey(`orgs/${org}/tracks/abc.wav`)).toBe(true);
    expect(isAnyOrgUploadKey(`local:orgs/${org}/tracks/sid`)).toBe(true);
    expect(isAnyOrgUploadKey('tracks/abc.wav')).toBe(false);
    expect(isAnyOrgUploadKey('local:sid')).toBe(false);
  });
});

describe('org masters (R-05: never a public derivative)', () => {
  it('recognises an org master in any bucket, and nothing else', () => {
    expect(isOrgMasterRef(`r2://masters/orgs/${org}/tracks/abc.wav`)).toBe(true);
    expect(isOrgMasterRef(`r2://other/orgs/${org}/tracks/abc.wav`)).toBe(true);
    expect(isOrgMasterRef('r2://masters/tracks/abc.wav')).toBe(false);
    expect(isOrgMasterRef('/uploads/abc.wav')).toBe(false);
    expect(isOrgMasterRef('https://cdn.example.com/orgs/x/tracks/a.wav')).toBe(false);
    expect(isOrgMasterRef(null)).toBe(false);
    expect(isOrgMasterRef('Night Shift 140 Fm.wav')).toBe(false);
  });
});

describe('private org media (D8, R-05)', () => {
  it('keys previews and peaks under orgs/<org>/<kind>/', () => {
    expect(orgMediaKey(ORG, 'previews', 'abc123', 'mp3')).toBe(`orgs/${org}/previews/abc123.mp3`);
    expect(orgMediaKey(ORG, 'peaks', 'abc123', 'json')).toBe(`orgs/${org}/peaks/abc123.json`);
    expect(orgMediaKey(ORG, 'previews', 'abc', 'm p3/../')).toBe(`orgs/${org}/previews/abc.mp3`);
  });

  it('accepts only the private bucket under the org prefix', () => {
    const ok = { orgId: ORG, privateBucket: 'masters', kind: 'previews' as const };
    expect(isPrivateOrgMediaRef(`r2://masters/orgs/${org}/previews/a.mp3`, ok)).toBe(true);
    expect(isPrivateOrgMediaRef(`r2://public-bucket/orgs/${org}/previews/a.mp3`, ok)).toBe(false);
    expect(isPrivateOrgMediaRef(`r2://masters/previews/a.mp3`, ok)).toBe(false);
    expect(isPrivateOrgMediaRef(`r2://masters/orgs/${OTHER}/previews/a.mp3`, ok)).toBe(false);
    expect(isPrivateOrgMediaRef(`https://cdn.example.com/orgs/${org}/previews/a.mp3`, ok)).toBe(false);
    expect(isPrivateOrgMediaRef(`r2://masters/orgs/${org}/previews/a.mp3`, { ...ok, privateBucket: '' })).toBe(false);
  });
});

describe('what an org upload becomes', () => {
  it('a new song: type song, stage inbox', () => {
    expect(orgUploadTrackFields({ kind: 'song', contactId: OTHER })).toEqual({ type: 'song', song_stage: 'inbox' });
  });

  it('linked material: a type that fits the relation, no stage', () => {
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'master' })).toEqual({ type: 'song', song_stage: null });
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'demo' })).toEqual({ type: 'song', song_stage: null });
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'version' })).toEqual({ type: 'song', song_stage: null });
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'instrumental' })).toEqual({ type: 'instrumental', song_stage: null });
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'loop' })).toEqual({ type: 'loop', song_stage: null });
    expect(orgUploadTrackFields({ kind: 'link', songId: OTHER, relation: 'topline' })).toEqual({ type: 'topline', song_stage: null });
  });

  // Classification follows the link (LABEL-13 carry): every relation an
  // upload can be added "as" must give the new track a recording kind, so it
  // is playable to whoever holds the matching audio capability.
  it.each(ORG_UPLOAD_RELATIONS)('an upload added as %s is classified through its link', (relation) => {
    const fields = orgUploadTrackFields({ kind: 'link', songId: OTHER, relation });
    const contexts = recordingContexts(fields, [{ relation, fromType: 'song' }]);
    expect(contexts).not.toBeNull();
    const finished = relation === 'master' || relation === 'instrumental';
    expect(contexts!.every((c) => c.capability === (finished ? 'audio.finished' : 'audio.working'))).toBe(true);
  });

  it('a new song is classified as its own mix (working until selected)', () => {
    const contexts = recordingContexts(orgUploadTrackFields({ kind: 'song', contactId: OTHER }), []);
    expect(contexts).toEqual([{ kind: 'mix', current: true, capability: 'audio.working' }]);
  });

  it('the JSON view carries no stored reference', () => {
    const view = orgUploadTrackView({
      id: 't1', org_id: org, title: 'Night Shift', type: 'song', song_stage: 'inbox',
      bpm: 140, key: 'F', scale: 'minor', duration_seconds: 120,
      audio_url: `r2://masters/orgs/${org}/tracks/x.wav`, preview_url: `r2://masters/orgs/${org}/previews/y.mp3`,
      peaks_url: null, wav_url: 'r2://masters/x.wav', user_id: 'u1', created_by: 'u1',
    }, { projectIds: ['p1'], linkedTo: null });
    expect(view).toEqual({
      id: 't1', orgId: org, title: 'Night Shift', type: 'song', songStage: 'inbox',
      bpm: 140, key: 'F', scale: 'minor', durationSeconds: 120,
      projectIds: ['p1'], linkedTo: null, playUrl: `/api/org/${org}/audio/t1`,
    });
    expect(JSON.stringify(view)).not.toMatch(/r2:\/\/|user_id|u1/);
  });

  it('plays through the LABEL-13 route, never /api/audio', () => {
    expect(orgUploadPlayUrl(ORG, 't1')).toBe(`/api/org/${org}/audio/t1`);
    expect(orgUploadPlayUrl(ORG, 't1', 'preview')).toBe(`/api/org/${org}/audio/t1?variant=preview`);
  });
});

describe('org upload contracts', () => {
  const song = { kind: 'song', contactId: OTHER };
  it('init needs a file and an intent', () => {
    expect(OrgUploadInitSchema.safeParse({ fileName: 'a.wav', fileSize: 10, as: song }).success).toBe(true);
    expect(OrgUploadInitSchema.safeParse({ fileName: 'a.wav', fileSize: 10 }).success).toBe(false);
    expect(OrgUploadInitSchema.safeParse({ fileName: 'a.wav', fileSize: 0, as: song }).success).toBe(false);
  });

  it('never takes a destination project, a replace target, a track type or a URL from the client', () => {
    const parsed = OrgUploadInitSchema.parse({
      fileName: 'a.wav', fileSize: 10, as: song,
      projectId: OTHER, replaceTrackId: OTHER, trackType: 'beat', audio_url: 'r2://x/y',
    });
    expect(parsed).toEqual({ fileName: 'a.wav', fileSize: 10, as: song });
  });

  it('a link names a song and one of the upload relations; beat is not one', () => {
    expect(OrgUploadCompleteSchema.safeParse({ sessionId: 's', as: { kind: 'link', songId: OTHER, relation: 'master' } }).success).toBe(true);
    expect(OrgUploadCompleteSchema.safeParse({ sessionId: 's', as: { kind: 'link', songId: OTHER, relation: 'beat' } }).success).toBe(false);
    expect(OrgUploadCompleteSchema.safeParse({ sessionId: 's', as: { kind: 'link', songId: 'nope', relation: 'demo' } }).success).toBe(false);
    expect(OrgUploadCompleteSchema.safeParse({ sessionId: 's', as: { kind: 'song' } }).success).toBe(false);
  });
});
