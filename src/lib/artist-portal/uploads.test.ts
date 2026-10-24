import { describe, expect, it } from 'vitest';
import { buildPortalUploadNotification, filesForContact, portalUploadDecision } from './uploads';
import { toPortalFile } from './view';

describe('portalUploadDecision', () => {
  const links = [{ project_id: 'p1' }, { project_id: 'p2' }];
  it('allows a portal project whose link has uploads on', () => {
    expect(portalUploadDecision(links, new Set(['p1']), 'p1')).toBe('ok');
  });
  it('refuses openly a portal project with uploads off', () => {
    expect(portalUploadDecision(links, new Set(['p1']), 'p2')).toBe('uploads-off');
  });
  it('answers a project outside the portal as not found, even if a stale switch says on', () => {
    expect(portalUploadDecision(links, new Set(['p3']), 'p3')).toBe('not-found');
  });
});

describe('filesForContact', () => {
  const rows = [
    { fileId: 'a', uploadedBy: null },
    { fileId: 'b', uploadedBy: 'c1' },
    { fileId: 'c', uploadedBy: 'c2' },
  ];
  it('drops only what this contact sent themselves', () => {
    expect(filesForContact(rows, 'c1').map((r) => r.fileId)).toEqual(['a', 'c']);
    expect(filesForContact(rows, 'c2').map((r) => r.fileId)).toEqual(['a', 'b']);
  });
});

describe('buildPortalUploadNotification', () => {
  it('names the contact and the project and never carries a token', () => {
    const n = buildPortalUploadNotification({
      ownerId: 'o', contactId: 'c1', contactName: 'Nova', projectId: 'p1', projectName: 'EP', assetId: 'f1', label: 'Verse idea',
    });
    expect(n).toMatchObject({ user_id: 'o', kind: 'portal_upload', title: 'Nova uploaded a file to EP', body: 'Verse idea' });
    expect(JSON.stringify(n)).not.toMatch(/token/i);
  });
});

describe('toPortalFile from the artist', () => {
  it('is marked as theirs and never NEW to them', () => {
    const f = toPortalFile(
      { id: 'f1', project_id: 'p1', kind: 'audio', label: 'Verse', file_name: 'v.wav', mime: 'audio/wav', size_bytes: 10 },
      { token: 'tok', isNew: true, fromYou: true },
    );
    expect(f).toMatchObject({ fromYou: true, isNew: false });
  });
});
