import { describe, expect, it } from 'vitest';
import { inboxProjectName, planInboxProject, type InboxPlanProject } from './inbox-project';

const ORG = 'org-L';
const nova = { id: 'c-nova', orgId: ORG, name: 'Nova' };
const p = (over: Partial<InboxPlanProject> & { id: string }): InboxPlanProject => ({
  orgId: ORG, inboxForContactId: null, status: 'in_progress', createdAt: '2026-10-01T00:00:00Z', ...over,
});

describe('planInboxProject (17 R1, Q1: one inbox project per artist)', () => {
  it('does nothing when the song is already in a project of this org', () => {
    const plan = planInboxProject({ orgId: ORG, contact: nova, songProjectIds: ['p-ep'], projects: [p({ id: 'p-ep' })] });
    expect(plan).toEqual({ action: 'none', projectIds: ['p-ep'] });
  });

  it("puts a song in no project into the artist's existing inbox", () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: [],
      projects: [p({ id: 'p-ep' }), p({ id: 'p-inbox', inboxForContactId: 'c-nova' })],
    });
    expect(plan).toEqual({ action: 'use', projectId: 'p-inbox', reopen: false });
  });

  it('creates the inbox the first time, named for the artist', () => {
    const plan = planInboxProject({ orgId: ORG, contact: nova, songProjectIds: [], projects: [p({ id: 'p-ep' })] });
    expect(plan).toEqual({ action: 'create', project: { orgId: ORG, inboxForContactId: 'c-nova', name: 'Inbox · Nova', status: 'in_progress' } });
  });

  it('keeps one inbox per artist: another artist’s inbox is not this one', () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: [],
      projects: [p({ id: 'p-kilo-inbox', inboxForContactId: 'c-kilo' })],
    });
    expect(plan.action).toBe('create');
  });

  it('reuses an archived inbox (there is only ever one) and says to reopen it', () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: [],
      projects: [p({ id: 'p-inbox', inboxForContactId: 'c-nova', status: 'archived' })],
    });
    expect(plan).toEqual({ action: 'use', projectId: 'p-inbox', reopen: true });
  });

  it('picks the oldest when duplicates exist (a race), so every song lands in the same one', () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: [],
      projects: [
        p({ id: 'p-late', inboxForContactId: 'c-nova', createdAt: '2026-10-02T00:00:00Z' }),
        p({ id: 'p-early', inboxForContactId: 'c-nova', createdAt: '2026-10-01T00:00:00Z' }),
      ],
    });
    expect(plan).toEqual({ action: 'use', projectId: 'p-early', reopen: false });
  });

  it('prefers an open inbox over an archived duplicate', () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: [],
      projects: [
        p({ id: 'p-old', inboxForContactId: 'c-nova', status: 'archived', createdAt: '2026-09-01T00:00:00Z' }),
        p({ id: 'p-open', inboxForContactId: 'c-nova', createdAt: '2026-10-01T00:00:00Z' }),
      ],
    });
    expect(plan).toEqual({ action: 'use', projectId: 'p-open', reopen: false });
  });

  it('never counts or reuses another org’s project, nor a producer project (org_id null)', () => {
    const plan = planInboxProject({
      orgId: ORG, contact: nova, songProjectIds: ['p-x', 'p-producer'],
      projects: [
        p({ id: 'p-x', orgId: 'org-other', inboxForContactId: 'c-nova' }),
        p({ id: 'p-producer', orgId: null }),
      ],
    });
    expect(plan.action).toBe('create');
  });

  it('refuses an artist who is not in this org, and a song with no artist', () => {
    expect(planInboxProject({ orgId: ORG, contact: { ...nova, orgId: 'org-other' }, songProjectIds: [], projects: [] }))
      .toEqual({ action: 'error', reason: 'contact_not_in_org' });
    expect(planInboxProject({ orgId: ORG, contact: null, songProjectIds: [], projects: [] }))
      .toEqual({ action: 'error', reason: 'no_artist' });
  });

  it('a song already in a project needs no artist', () => {
    expect(planInboxProject({ orgId: ORG, contact: null, songProjectIds: ['p-ep'], projects: [p({ id: 'p-ep' })] }).action).toBe('none');
  });
});

describe('inboxProjectName', () => {
  it('names the artist, falling back when the name is blank', () => {
    expect(inboxProjectName('  Nova ')).toBe('Inbox · Nova');
    expect(inboxProjectName('')).toBe('Inbox · Artist');
    expect(inboxProjectName(null)).toBe('Inbox · Artist');
  });
});
