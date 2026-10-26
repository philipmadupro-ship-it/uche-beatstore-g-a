import { describe, expect, it } from 'vitest';
import { EXTERNAL_PROJECT_ROLES, externalCan } from './capabilities';
import {
  EXTERNAL_UPLOAD_RELATIONS,
  allowedActions,
  externalAudioAction,
  externalAudioIsAudited,
  externalMayAny,
  membershipLive,
  planExternalUpload,
  planProjectMemberChange,
  projectRoleSummary,
  sharedProjectHref,
  sortSharedProjects,
  toMembership,
  validateProjectInvite,
  type ExternalMembership,
} from './project-members';
import { parseOrgAudioVariant } from './org-audio';

const NOW = new Date('2026-10-06T12:00:00Z');
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const m = (role: ExternalMembership['role'], allowDownloads = false, projectId = P1): ExternalMembership => ({ projectId, role, allowDownloads });

describe('membership liveness', () => {
  it('no expiry is live; a future expiry is live; a past one is not', () => {
    expect(membershipLive(null, NOW)).toBe(true);
    expect(membershipLive('2026-10-07T00:00:00Z', NOW)).toBe(true);
    expect(membershipLive('2026-10-06T11:59:59Z', NOW)).toBe(false);
    expect(membershipLive('2026-10-06T12:00:00Z', NOW)).toBe(false);
  });
  it('an unparseable expiry fails closed', () => {
    expect(membershipLive('soon', NOW)).toBe(false);
  });
  it('toMembership drops an expired row and an unknown role', () => {
    expect(toMembership({ project_id: P1, role: 'editor', allow_downloads: null, expires_at: null }, NOW)).toEqual({
      projectId: P1,
      role: 'editor',
      allowDownloads: false,
    });
    expect(toMembership({ project_id: P1, role: 'editor', allow_downloads: true, expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBeNull();
    expect(toMembership({ project_id: P1, role: 'owner', allow_downloads: true, expires_at: null }, NOW)).toBeNull();
    expect(toMembership({ project_id: P1, role: 'admin', allow_downloads: true, expires_at: null }, NOW)).toBeNull();
  });
});

describe('audio: listening is not downloading', () => {
  const v = (raw: string) => parseOrgAudioVariant(raw)!;
  it.each([
    ['preview', false, 'listen'],
    ['peaks', false, 'listen'],
    ['full', false, 'listen'],
    ['full', true, 'download_masters'],
    ['preview', true, 'download_masters'],
    ['wav', false, 'download_masters'],
    ['stem:vocals', false, 'download_masters'],
  ])('%s download=%s → %s', (variant, download, action) => {
    expect(externalAudioAction(v(variant), download)).toBe(action);
  });
  it('only handing the file over is audited', () => {
    expect(externalAudioIsAudited('download_masters')).toBe(true);
    expect(externalAudioIsAudited('listen')).toBe(false);
  });
  it('every role listens; downloads follow §2.6', () => {
    for (const role of EXTERNAL_PROJECT_ROLES) expect(externalMayAny([m(role)], 'listen')).toBe(true);
    expect(externalMayAny([m('viewer')], 'download_masters')).toBe(false);
    expect(externalMayAny([m('viewer', true)], 'download_masters')).toBe(true);
    expect(externalMayAny([m('commenter')], 'download_masters')).toBe(false);
    expect(externalMayAny([m('contributor')], 'download_masters')).toBe(true);
    expect(externalMayAny([m('editor')], 'download_masters')).toBe(true);
  });
  it('two projects: any one that grants is enough', () => {
    expect(externalMayAny([m('viewer', false, P1), m('viewer', true, P2)], 'download_masters')).toBe(true);
  });
});

describe('planExternalUpload', () => {
  it('a contributor adds a version to a song in their project, and only there', () => {
    expect(planExternalUpload([m('contributor')], [P1, P2], 'version')).toEqual({ ok: true, projectIds: [P1] });
  });
  it('lands in each of the member’s upload-capable projects the song is in', () => {
    expect(planExternalUpload([m('editor', false, P1), m('contributor', false, P2)], [P1, P2], 'version')).toEqual({
      ok: true,
      projectIds: [P1, P2],
    });
  });
  it('a viewer or commenter cannot upload (403, they know the song)', () => {
    for (const role of ['viewer', 'commenter'] as const) {
      expect(planExternalUpload([m(role)], [P1], 'version')).toMatchObject({ ok: false, status: 403 });
    }
  });
  it('a song outside their projects is 404', () => {
    expect(planExternalUpload([m('editor', false, P1)], [P2], 'version')).toMatchObject({ ok: false, status: 404 });
    expect(planExternalUpload([m('editor')], [], 'version')).toMatchObject({ ok: false, status: 404 });
    expect(planExternalUpload([], [P1], 'version')).toMatchObject({ ok: false, status: 404 });
  });
  it('a viewer in one project and a contributor in another uploads only into the second', () => {
    expect(planExternalUpload([m('viewer', false, P1), m('contributor', false, P2)], [P1, P2], 'version')).toEqual({ ok: true, projectIds: [P2] });
  });
  it('material that vouches for finished music is not offered', () => {
    for (const relation of ['master', 'instrumental', 'demo', 'loop', 'topline', 'beat', 'x']) {
      expect(planExternalUpload([m('editor')], [P1], relation)).toMatchObject({ ok: false, status: 403 });
    }
    expect(EXTERNAL_UPLOAD_RELATIONS).toEqual(['version']);
  });
});

describe('validateProjectInvite', () => {
  it('normalises the address and accepts the four roles', () => {
    for (const role of EXTERNAL_PROJECT_ROLES) {
      expect(validateProjectInvite({ email: ' Guest@Local.Test ', role })).toEqual({ ok: true, email: 'guest@local.test', role, allowDownloads: false });
    }
    expect(validateProjectInvite({ email: 'a@b.test', role: 'viewer', allowDownloads: true })).toMatchObject({ ok: true, allowDownloads: true });
  });
  it('refuses anything else', () => {
    expect(validateProjectInvite({ email: 'a@b.test', role: 'owner' })).toMatchObject({ ok: false });
    expect(validateProjectInvite({ email: 'a@b.test', role: 'admin' })).toMatchObject({ ok: false });
    expect(validateProjectInvite({ email: 'a@b.test', role: '' })).toMatchObject({ ok: false });
    expect(validateProjectInvite({ email: 'not an email', role: 'viewer' })).toMatchObject({ ok: false });
    expect(validateProjectInvite({ email: '  ', role: 'viewer' })).toMatchObject({ ok: false });
  });
});

describe('planProjectMemberChange', () => {
  const cur = { role: 'viewer', allow_downloads: false, expires_at: null };
  it('writes and audits only what changes', () => {
    expect(planProjectMemberChange(cur, { role: 'commenter', allowDownloads: false }, NOW)).toEqual({
      ok: true,
      patch: { role: 'commenter' },
      payload: { role: { from: 'viewer', to: 'commenter' } },
    });
    expect(planProjectMemberChange(cur, { allowDownloads: true }, NOW)).toEqual({
      ok: true,
      patch: { allow_downloads: true },
      payload: { allow_downloads: { from: false, to: true } },
    });
  });
  it('nothing to change is an error, not a silent no-op', () => {
    expect(planProjectMemberChange(cur, { role: 'viewer' }, NOW)).toEqual({ ok: false, error: 'Nothing to change' });
    expect(planProjectMemberChange(cur, {}, NOW)).toEqual({ ok: false, error: 'Nothing to change' });
  });
  it('refuses an unknown role', () => {
    expect(planProjectMemberChange(cur, { role: 'owner' }, NOW)).toMatchObject({ ok: false });
  });
  it('an expiry must be a future date; null clears it', () => {
    expect(planProjectMemberChange(cur, { expiresAt: '2026-11-01T00:00:00Z' }, NOW)).toMatchObject({ ok: true, patch: { expires_at: '2026-11-01T00:00:00Z' } });
    expect(planProjectMemberChange(cur, { expiresAt: '2026-10-01T00:00:00Z' }, NOW)).toMatchObject({ ok: false });
    expect(planProjectMemberChange(cur, { expiresAt: 'tomorrow' }, NOW)).toMatchObject({ ok: false });
    expect(planProjectMemberChange({ ...cur, expires_at: '2026-11-01T00:00:00Z' }, { expiresAt: null }, NOW)).toMatchObject({
      ok: true,
      patch: { expires_at: null },
    });
    expect(planProjectMemberChange({ ...cur, expires_at: '2026-11-01T00:00:00Z' }, { expiresAt: '2026-11-01T00:00:00.000Z' }, NOW)).toEqual({
      ok: false,
      error: 'Nothing to change',
    });
  });
});

describe('summaries', () => {
  it('state the §2.6 table', () => {
    expect(projectRoleSummary('viewer', false)).toBe('Listens; no downloads');
    expect(projectRoleSummary('viewer', true)).toBe('Listens; downloads masters');
    expect(projectRoleSummary('commenter', false)).toBe('Listens, comments; no downloads');
    expect(projectRoleSummary('contributor', false)).toBe('Listens, comments, uploads versions; downloads masters');
    expect(projectRoleSummary('editor', false)).toBe('Listens, comments, uploads versions, edits metadata; downloads masters');
  });
  it('allowedActions agrees with externalCan for every cell', () => {
    for (const role of EXTERNAL_PROJECT_ROLES) {
      for (const dl of [false, true]) {
        for (const a of allowedActions(role, dl)) expect(externalCan(role, a, { allowDownloads: dl })).toBe(true);
      }
    }
    expect(allowedActions('viewer', false)).toEqual(['listen']);
  });
  it('hrefs and ordering', () => {
    expect(sharedProjectHref(P1)).toBe(`/shared/${P1}`);
    expect(sortSharedProjects([{ name: 'b', orgName: 'z' }, { name: 'a', orgName: 'y' }, { name: 'a', orgName: 'x' }])).toEqual([
      { name: 'a', orgName: 'x' },
      { name: 'a', orgName: 'y' },
      { name: 'b', orgName: 'z' },
    ]);
  });
});
