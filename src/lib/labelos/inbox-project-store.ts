/**
 * Writes for where an org song lives (LABEL-14). The rule is the pure
 * planner in ./inbox-project (LABEL-11, Q1: one Inbox per artist); this
 * module loads its inputs and carries out the plan on the service-role
 * client — the only role migration 141 lets write an org row.
 *
 * Every function takes the org explicitly and filters by it: callers are
 * /api/org routes that have already authorised the member, and nothing here
 * ever reads or writes a producer row (org_id IS NULL).
 */

import { planInboxProject, type InboxPlanProject } from './inbox-project';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

type ProjectRow = { id: string; org_id: string | null; inbox_for_contact_id: string | null; status: string | null; created_at: string };

const UNIQUE_VIOLATION = '23505';

function toPlanProject(p: ProjectRow): InboxPlanProject {
  return { id: p.id, orgId: p.org_id, inboxForContactId: p.inbox_for_contact_id, status: p.status, createdAt: p.created_at };
}

async function inboxesOf(admin: Admin, orgId: string, contactId: string): Promise<ProjectRow[]> {
  const { data, error } = await admin
    .from('projects')
    .select('id, org_id, inbox_for_contact_id, status, created_at')
    .eq('org_id', orgId)
    .eq('inbox_for_contact_id', contactId);
  if (error) throw new Error(`Inbox lookup failed: ${error.message}`);
  return (data ?? []) as ProjectRow[];
}

/**
 * The artist's Inbox project in `orgId`, created on first need. An archived
 * inbox is reopened rather than duplicated. Two uploads racing to create it
 * meet on `projects_inbox_for_contact_uniq` (migration 141): the loser
 * re-reads and uses the winner's.
 */
export async function ensureInboxProject(
  admin: Admin,
  opts: { orgId: string; contactId: string; actorId: string },
): Promise<{ projectId: string; created: boolean }> {
  const { orgId, contactId, actorId } = opts;
  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .select('id, org_id, name')
    .eq('id', contactId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (contactError) throw new Error(`Artist lookup failed: ${contactError.message}`);
  const c = contact as { id: string; org_id: string | null; name: string | null } | null;

  const plan = planInboxProject({
    orgId,
    contact: c ? { id: c.id, orgId: c.org_id, name: c.name } : null,
    songProjectIds: [],
    projects: (await inboxesOf(admin, orgId, contactId)).map(toPlanProject),
  });

  switch (plan.action) {
    case 'use': {
      if (plan.reopen) {
        const { error } = await admin.from('projects').update({ status: 'in_progress' }).eq('id', plan.projectId).eq('org_id', orgId);
        if (error) throw new Error(`Inbox reopen failed: ${error.message}`);
      }
      return { projectId: plan.projectId, created: false };
    }
    case 'create': {
      const { data, error } = await admin
        .from('projects')
        .insert({
          // user_id is NOT NULL; 141's guards keep it from granting a read.
          user_id: actorId,
          org_id: plan.project.orgId,
          inbox_for_contact_id: plan.project.inboxForContactId,
          name: plan.project.name,
          status: plan.project.status,
        })
        .select('id')
        .single();
      if (!error && data) return { projectId: (data as { id: string }).id, created: true };
      if (error?.code === UNIQUE_VIOLATION) {
        const winner = (await inboxesOf(admin, orgId, contactId))[0];
        if (winner) return { projectId: winner.id, created: false };
      }
      throw new Error(`Inbox create failed: ${error?.message ?? 'no row returned'}`);
    }
    case 'error':
      throw new Error(plan.reason === 'no_artist' ? 'Artist not found' : 'Artist is not in this organization');
    case 'none':
      // Unreachable: a new song is in no project yet.
      return { projectId: plan.projectIds[0], created: false };
  }
}

/** The projects OF `orgId` that `trackId` sits in (project_tracks), oldest link first. */
export async function orgProjectsOfTrack(admin: Admin, orgId: string, trackId: string): Promise<string[]> {
  const links = await admin.from('project_tracks').select('project_id').eq('track_id', trackId);
  if (links.error) throw new Error(`Project lookup failed: ${links.error.message}`);
  const ids = [...new Set(((links.data ?? []) as { project_id: string }[]).map((l) => l.project_id))];
  if (ids.length === 0) return [];
  const inOrg = await admin.from('projects').select('id').in('id', ids).eq('org_id', orgId);
  if (inOrg.error) throw new Error(`Project lookup failed: ${inOrg.error.message}`);
  const keep = new Set(((inOrg.data ?? []) as { id: string }[]).map((p) => p.id));
  return ids.filter((id) => keep.has(id));
}

/**
 * Put `trackId` at the end of each of `projectIds` (all of `orgId`; 142's
 * trigger refuses anything else). Already there → left as is.
 */
export async function addTrackToOrgProjects(
  admin: Admin,
  opts: { orgId: string; trackId: string; projectIds: readonly string[] },
): Promise<void> {
  if (opts.projectIds.length === 0) return;
  const inOrg = await admin.from('projects').select('id').in('id', [...opts.projectIds]).eq('org_id', opts.orgId);
  if (inOrg.error) throw new Error(`Project lookup failed: ${inOrg.error.message}`);
  const allowed = new Set(((inOrg.data ?? []) as { id: string }[]).map((p) => p.id));
  for (const projectId of opts.projectIds) {
    if (!allowed.has(projectId)) throw new Error('Project is not in this organization');
    const existing = await admin.from('project_tracks').select('track_id, position').eq('project_id', projectId);
    if (existing.error) throw new Error(`Project attach failed: ${existing.error.message}`);
    const rows = (existing.data ?? []) as { track_id: string; position: number | null }[];
    if (rows.some((r) => r.track_id === opts.trackId)) continue;
    const position = rows.reduce((m, r) => Math.max(m, (r.position ?? 0) + 1), 0);
    const { error } = await admin.from('project_tracks').insert({ project_id: projectId, track_id: opts.trackId, role: 'main', position });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(`Project attach failed: ${error.message}`);
  }
}
