/**
 * /api/org/[orgId]/projects/[id]/members (LABEL-21, W4) — who from OUTSIDE
 * the org is on this project. Capability `share.external` on the project
 * (requireObjectAccess: row org, artist scope, then the capability), so an
 * external member can never reach it — they are 404 here like any stranger.
 *
 *  GET  — the project's external members and its pending project
 *         invitations. Identity is the display name and, for a manager, the
 *         address the invitation went to. Never a token or its hash.
 *  POST — invite someone by email as viewer / commenter / contributor /
 *         editor (06 §2.6). Same hardening as org invitations (06 §5): 32
 *         random bytes, only the sha-256 stored, 7-day expiry, the address
 *         normalised, one pending invitation per address per project,
 *         rate-limited. `invitation.created` is an audit event written by
 *         the database function that inserts the row (migration 148), in one
 *         transaction. The person becomes a member only by accepting with
 *         the matching verified account (`/api/org/join`), which writes
 *         `project_members` — never `org_members` — and `project.member_added`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { projectMemberRows, requireObjectAccess } from '@/lib/auth/org-access';
import { OrgProjectInviteBodySchema } from '@/lib/contracts';
import { getAppUrl } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { PROJECT_MEMBERS_NOT_READY, auditRpc, isMissingProjectMembers } from '@/lib/labelos/audit-rpc';
import { inviterDisplayName, sendProjectInvitationEmail } from '@/lib/labelos/invitation-email';
import { INVITATION_TTL_MS, newInvitationToken } from '@/lib/labelos/invitations';
import { memberIdentities } from '@/lib/labelos/member-identity';
import { PROJECT_ROLE_LABELS, membershipLive, projectRoleSummary, validateProjectInvite, isExternalProjectRole } from '@/lib/labelos/project-members';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.projects.members');

type Params = { params: Promise<{ orgId: string; id: string }> };

type MemberRow = {
  user_id: string;
  role: string;
  allow_downloads: boolean | null;
  expires_at: string | null;
  created_at: string;
  invitation_id: string | null;
};
type InvitationRow = {
  id: string;
  email: string;
  project_role: string | null;
  project_allow_downloads: boolean | null;
  expires_at: string;
  created_at: string;
};

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'share.external', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  try {
    const [membersRes, invitesRes] = await Promise.all([
      projectMemberRows(admin, access, id).list('user_id, role, allow_downloads, expires_at, created_at, invitation_id'),
      // Keyed by org AND project: the project was authorised above (scope
      // included), and an invitation has no artist column of its own for
      // scopedOrgQuery to narrow by.
      admin
        .from('org_invitations')
        .select('id, email, project_role, project_allow_downloads, expires_at, created_at')
        .eq('org_id', access.orgId)
        .eq('project_id', id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);
    // Migration 148 not applied: an empty panel that says so, not a 500.
    if (isMissingProjectMembers(membersRes.error)) {
      return NextResponse.json({ members: [], invitations: [], schemaReady: false }, { headers: noStore });
    }
    if (membersRes.error) throw new Error(membersRes.error.message);
    if (invitesRes.error) throw new Error(invitesRes.error.message);
    const members = (membersRes.data ?? []) as unknown as MemberRow[];
    const invites = (invitesRes.data ?? []) as unknown as InvitationRow[];

    const identities = await memberIdentities(admin, access.orgId, members.map((m) => m.user_id), { withEmail: false });
    // The address a person was invited at: the invitation they accepted.
    const accepted = members.map((m) => m.invitation_id).filter((v): v is string => !!v);
    const emailByInvitation = new Map<string, string>();
    if (accepted.length > 0) {
      const res = await admin.from('org_invitations').select('id, email').eq('org_id', access.orgId).eq('project_id', id).in('id', accepted);
      if (res.error) throw new Error(res.error.message);
      for (const r of (res.data ?? []) as unknown as { id: string; email: string }[]) emailByInvitation.set(r.id, r.email);
    }

    return NextResponse.json(
      {
        members: members.map((m) => ({
          user_id: m.user_id,
          name: identities.get(m.user_id)?.name ?? null,
          email: m.invitation_id ? (emailByInvitation.get(m.invitation_id) ?? null) : null,
          role: m.role,
          allow_downloads: m.allow_downloads === true,
          expires_at: m.expires_at,
          live: membershipLive(m.expires_at),
          created_at: m.created_at,
          summary: isExternalProjectRole(m.role) ? projectRoleSummary(m.role, m.allow_downloads === true) : null,
        })),
        invitations: invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.project_role,
          allow_downloads: i.project_allow_downloads === true,
          expires_at: i.expires_at,
          created_at: i.created_at,
        })),
      },
      { headers: noStore },
    );
  } catch (err) {
    log.error('list project members failed', { orgId: access.orgId, projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list the project members' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'share.external', orgId });
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgProjectInviteBodySchema);
  if (!parsed.ok) return parsed.res;
  const invite = validateProjectInvite({ email: parsed.data.email, role: parsed.data.role, allowDownloads: parsed.data.allow_downloads });
  if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 400 });

  const { admin } = access;
  try {
    const [pendingRes, orgRes, projectRes, inviterName] = await Promise.all([
      admin
        .from('org_invitations')
        .select('id')
        .eq('org_id', access.orgId)
        .eq('project_id', id)
        .eq('email', invite.email)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true }),
      admin.from('organizations').select('name').eq('id', access.orgId).maybeSingle(),
      admin.from('projects').select('name').eq('id', id).eq('org_id', access.orgId).maybeSingle(),
      inviterDisplayName(admin, access.userId),
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (orgRes.error) throw new Error(orgRes.error.message);
    if (projectRes.error) throw new Error(projectRes.error.message);
    const conflict = (invitationId: string) =>
      NextResponse.json(
        { error: 'This address already has a pending invitation to this project. Revoke it to send a new one.', invitationId },
        { status: 409 },
      );
    const pending = (pendingRes.data ?? []) as unknown as { id: string }[];
    if (pending.length > 0) return conflict(pending[0].id);
    const orgName = (orgRes.data as { name?: string } | null)?.name ?? 'your organization';
    const projectName = (projectRes.data as { name?: string } | null)?.name ?? 'a project';

    const [orgOk, addressOk] = await Promise.all([
      rateLimitDurable(`org-invite:${access.orgId}`, 30, 60 * 60 * 1000),
      rateLimitDurable(`org-invite:${access.orgId}:${invite.email}`, 5, 24 * 60 * 60 * 1000),
    ]);
    if (!orgOk || !addressOk) return NextResponse.json({ error: 'Too many invitations. Try again later.' }, { status: 429 });

    const { token, tokenHash } = newInvitationToken();
    const { data: result, error: rpcErr } = await auditRpc(admin, 'projectInvitationCreate', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_project: id,
      p_email: invite.email,
      p_role: invite.role,
      p_allow_downloads: invite.allowDownloads,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      p_payload: { email: invite.email, project_id: id, project_role: invite.role, allow_downloads: invite.allowDownloads },
    });
    if (isMissingProjectMembers(rpcErr)) return NextResponse.json({ error: PROJECT_MEMBERS_NOT_READY }, { status: 503 });
    if (rpcErr) throw new Error(rpcErr.message);
    if (result?.error === 'pending') return conflict(String(result.id ?? ''));
    if (result?.error === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const invitation = (result?.invitation ?? null) as Record<string, unknown> | null;
    if (!invitation) throw new Error('invitation insert returned nothing');

    const sent = await sendProjectInvitationEmail({
      to: invite.email,
      orgName,
      projectName,
      inviterName,
      roleLabel: PROJECT_ROLE_LABELS[invite.role],
      url: `${getAppUrl()}/join/${token}`,
    });

    return NextResponse.json(
      {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.project_role,
          allow_downloads: invitation.allow_downloads === true,
          expires_at: invitation.expires_at,
          created_at: invitation.created_at,
        },
        emailSent: sent.sent,
        ...(sent.sent ? {} : { emailError: sent.reason }),
      },
      { status: 201 },
    );
  } catch (err) {
    log.error('invite to project failed', { orgId: access.orgId, projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not create the invitation' }, { status: 500 });
  }
}
