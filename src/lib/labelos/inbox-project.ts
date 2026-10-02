/**
 * Every org song lives in at least one project (17 R1). A song that arrives
 * in none — a demo the artist uploads — goes into that artist's Inbox project:
 * one per artist contact, created on first need (Q1, answered yes 2026-10-02).
 *
 * This is the RULE, as a pure planner. `projects.org_id` arrives in
 * LABEL-12, so nothing here writes: `ensureInboxProject` (LABEL-12/14)
 * loads the inputs, runs this, and carries out the plan. How an inbox is
 * recognised on disk (`inboxForContactId`) is that writer's to persist.
 */

export interface InboxPlanProject {
  id: string;
  /** null = a producer project; never counts for an org song. */
  orgId: string | null;
  /** The roster contact this project is the inbox for; null for an ordinary project. */
  inboxForContactId: string | null;
  /** `projects.status` (in_progress | final | archived). */
  status: string | null;
  createdAt: string;
}

export interface InboxPlanContact {
  id: string;
  /** `contacts.org_id` (mig 139). */
  orgId: string | null;
  name: string | null;
}

export type InboxPlan =
  | { action: 'none'; projectIds: string[] }
  | { action: 'use'; projectId: string; reopen: boolean }
  | { action: 'create'; project: { orgId: string; inboxForContactId: string; name: string; status: 'in_progress' } }
  | { action: 'error'; reason: 'no_artist' | 'contact_not_in_org' };

export function inboxProjectName(contactName: string | null): string {
  return `Inbox · ${contactName?.trim() || 'Artist'}`;
}

/**
 * Which project an org song belongs in.
 *   - Already in a project of THIS org → nothing to do.
 *   - Otherwise the artist's inbox: the open one if any, else the oldest
 *     (an archived inbox is still the one inbox, reopened rather than
 *     duplicated); oldest wins among duplicates so every song lands together.
 *   - No inbox yet → create one.
 * Another org's project, or a producer project (org_id null), never counts.
 */
export function planInboxProject(input: {
  orgId: string;
  contact: InboxPlanContact | null;
  /** Projects the song is already in (project_tracks). */
  songProjectIds: readonly string[];
  /** The candidate projects (at least the song's and the artist's inboxes). */
  projects: readonly InboxPlanProject[];
}): InboxPlan {
  const { orgId, contact } = input;
  const inOrg = input.projects.filter((p) => p.orgId === orgId);
  const current = input.songProjectIds.filter((id) => inOrg.some((p) => p.id === id));
  if (current.length > 0) return { action: 'none', projectIds: current };

  if (!contact) return { action: 'error', reason: 'no_artist' };
  if (contact.orgId !== orgId) return { action: 'error', reason: 'contact_not_in_org' };

  const inboxes = inOrg
    .filter((p) => p.inboxForContactId === contact.id)
    .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const inbox = inboxes[0];
  if (inbox) return { action: 'use', projectId: inbox.id, reopen: inbox.status === 'archived' };

  return {
    action: 'create',
    project: { orgId, inboxForContactId: contact.id, name: inboxProjectName(contact.name), status: 'in_progress' },
  };
}
