import { describe, expect, it } from 'vitest';
import { deriveRelationshipStage, isWorkspaceMode } from './relationship';

const base = { contacted: false, engaged: false, decisions: [], activeLinkedProjects: 0 };

describe('deriveRelationshipStage', () => {
  it('walks new → contacted → engaged → interested → working together → released', () => {
    expect(deriveRelationshipStage(base).stage).toBe('new');
    expect(deriveRelationshipStage({ ...base, contacted: true }).stage).toBe('contacted');
    expect(deriveRelationshipStage({ ...base, contacted: true, engaged: true }).stage).toBe('engaged');
    expect(deriveRelationshipStage({ ...base, contacted: true, decisions: ['interested', null] }).stage).toBe('interested');
    expect(deriveRelationshipStage({ ...base, decisions: ['selected'], activeLinkedProjects: 1 }).stage).toBe('working_together');
    expect(deriveRelationshipStage({ ...base, decisions: ['released'], activeLinkedProjects: 1 }).stage).toBe('released');
  });

  it('does not count a pass as interest', () => {
    expect(deriveRelationshipStage({ ...base, contacted: true, engaged: true, decisions: ['passed'] }).stage).toBe('engaged');
  });

  it('reports a manual park beside the derived stage instead of replacing it', () => {
    expect(deriveRelationshipStage({ ...base, contacted: true, crmStatus: 'cold' })).toEqual({ stage: 'contacted', parked: 'cold' });
    expect(deriveRelationshipStage({ ...base, crmStatus: 'customer' }).parked).toBeNull();
  });
});

describe('isWorkspaceMode', () => {
  it('is on for a contact linked to a project or holding a portal, off otherwise', () => {
    expect(isWorkspaceMode({ linkedProjects: 1, hasPortal: false })).toBe(true);
    expect(isWorkspaceMode({ linkedProjects: 0, hasPortal: true })).toBe(true);
    expect(isWorkspaceMode({ linkedProjects: 0, hasPortal: false })).toBe(false);
  });
});
