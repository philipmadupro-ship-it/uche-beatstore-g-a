import { describe, expect, it } from 'vitest';
import { parseOrgUploadTarget, uploadApiBase, uploadCompleteBody, uploadInitBody, type OrgUploadTarget } from './org-target';
import { normalisePersistedItem } from './persisted-uploads';

const ORG = '10000000-0000-4000-8000-000000000001';
const C1 = '30000000-0000-4000-8000-0000000000c1';
const S1 = '50000000-0000-4000-8000-000000000001';
const org: OrgUploadTarget = { orgId: ORG, as: { kind: 'song', contactId: C1 } };

const item = { fileName: 'a.wav', fileSize: 10, contentType: 'audio/wav', type: 'beat', projectId: 'p1', replaceTrackId: null };

describe('producer uploads are unchanged', () => {
  it('talk to /api/upload with the same init and complete bodies', () => {
    expect(uploadApiBase(null)).toBe('/api/upload');
    expect(uploadInitBody({ ...item, org: null })).toEqual({
      fileName: 'a.wav', fileSize: 10, fileType: 'audio/wav', trackType: 'beat', projectId: 'p1', replaceTrackId: null,
    });
    expect(uploadCompleteBody('s1', { bpm: 1 }, null)).toEqual({ sessionId: 's1', analysis: { bpm: 1 } });
  });
});

describe('org uploads', () => {
  it('talk to /api/org/<org>/upload and send the intent, never a type or a destination', () => {
    expect(uploadApiBase(org)).toBe(`/api/org/${ORG}/upload`);
    expect(uploadInitBody({ ...item, org })).toEqual({ fileName: 'a.wav', fileSize: 10, fileType: 'audio/wav', as: org.as });
    expect(uploadCompleteBody('s1', null, org)).toEqual({ sessionId: 's1', analysis: null, as: org.as });
  });

  it('restore from localStorage only when well formed', () => {
    expect(parseOrgUploadTarget(org)).toEqual(org);
    const linkTarget = { orgId: ORG, as: { kind: 'link', songId: S1, relation: 'master' } };
    expect(parseOrgUploadTarget(linkTarget)).toEqual(linkTarget);
    for (const bad of [null, 'x', { orgId: 'x', as: org.as }, { orgId: ORG }, { orgId: ORG, as: { kind: 'link', songId: S1, relation: 'beat' } },
      { orgId: ORG, as: { kind: 'song', contactId: '../x' } }]) {
      expect(parseOrgUploadTarget(bad)).toBeNull();
    }
  });

  it('a persisted row keeps its org target; an old row has none', () => {
    expect(normalisePersistedItem({ id: 'u1', fileName: 'a.wav', org })?.org).toEqual(org);
    expect(normalisePersistedItem({ id: 'u1', fileName: 'a.wav' })?.org).toBeNull();
    expect(normalisePersistedItem({ id: 'u1', fileName: 'a.wav', org: { orgId: 'nope' } })?.org).toBeNull();
  });
});
