'use client';

/**
 * Who from OUTSIDE the org is on this project (LABEL-21, W4) — the members
 * panel on `/o/<slug>/projects/<id>`. Rendered only for a member with
 * `share.external`; every request is re-authorised by the route (an external
 * member is a 404 there, the same as a stranger).
 *
 *   People outside <org> · Viewer · Commenter · Contributor · Editor
 *   Invite  [email]  [role ▾]  [allow downloads]  [Invite]
 *   Nova Beats   Contributor ▾   downloads on   ⋯ Remove
 *   producer@x.test  invited · expires Oct 13   Revoke
 *
 * The role list and the one-line "what this role may do" are the §2.6 table
 * itself (`projectRoleSummary`), so the panel never promises what the route
 * would refuse. A contributor or editor always downloads masters, so the
 * downloads switch only applies to viewers and commenters. Removing someone
 * asks first: their access ends on their very next request.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast, confirmToast } from '@/hooks/useToast';
import { EXTERNAL_PROJECT_ROLES, type ExternalProjectRole } from '@/lib/labelos/capabilities';
import { PROJECT_ROLE_LABELS, isExternalProjectRole, projectRoleSummary } from '@/lib/labelos/project-members';

type Member = {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  allow_downloads: boolean;
  expires_at: string | null;
  live: boolean;
  summary: string | null;
};
type Invitation = { id: string; email: string; role: string | null; allow_downloads: boolean; expires_at: string };
type Loaded = { members: Member[]; invitations: Invitation[]; schemaReady: boolean };

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUTTON =
  'inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

const ROLE_OPTIONS = EXTERNAL_PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABELS[r] }));

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ProjectMembersPanel({ orgId, orgName, projectId }: { orgId: string; orgName: string; projectId: string }) {
  const base = `/api/org/${orgId}/projects/${projectId}`;
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ExternalProjectRole>('contributor');
  const [downloads, setDownloads] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/members`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Partial<Loaded>;
      setData({ members: j.members ?? [], invitations: j.invitations ?? [], schemaReady: j.schemaReady !== false });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (path: string, init: RequestInit, ok: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { error?: string; emailSent?: boolean };
      if (!res.ok) {
        toast.error(body.error ?? 'Something went wrong');
        return false;
      }
      if (body.emailSent === false) toast.warning('The invitation was created but the email could not be sent. Revoke it and invite again.');
      else toast.success(ok);
      await load();
      return true;
    } catch {
      toast.error('Could not reach the server');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      toast.error('Enter a valid email address');
      return;
    }
    const sent = await call('/members', { method: 'POST', body: JSON.stringify({ email: email.trim(), role, allow_downloads: downloads }) }, 'Invitation sent');
    if (sent) setEmail('');
  };

  const remove = async (m: Member) => {
    const who = m.name ?? m.email ?? 'this person';
    const yes = await confirmToast(`Remove ${who} from this project?`, 'They lose access on their next request. What they uploaded stays here, credited to them.', {
      confirmLabel: 'Remove',
      danger: true,
    });
    if (yes) await call(`/members/${m.user_id}`, { method: 'DELETE' }, 'Removed');
  };

  const roleOptions = useMemo(() => ROLE_OPTIONS, []);
  const downloadsApply = role === 'viewer' || role === 'commenter';

  if (data && !data.schemaReady) return null;

  return (
    <section aria-labelledby="project-members" className="mb-10 space-y-3" data-testid="project-members">
      <h2 id="project-members" className={LABEL}>People outside {orgName}</h2>
      <div className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4">
        <form onSubmit={invite} className="flex flex-wrap items-center gap-2" noValidate>
          <label htmlFor="project-invite-email" className="sr-only">Email address</label>
          <input
            id="project-invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="producer@example.com"
            className="min-h-9 w-full rounded-lg border border-white/10 bg-[#090907] px-3 text-[12px] text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none sm:w-64"
          />
          <Dropdown aria-label="Role" value={role} onChange={(v) => setRole(v as ExternalProjectRole)} options={roleOptions} />
          <label className={`flex items-center gap-2 text-[11px] ${downloadsApply ? 'text-white/70' : 'text-white/30'}`}>
            <input
              type="checkbox"
              checked={downloadsApply ? downloads : true}
              disabled={!downloadsApply}
              onChange={(e) => setDownloads(e.target.checked)}
              className="h-3.5 w-3.5 accent-white"
            />
            Can download masters{downloadsApply ? '' : ' (always)'}
          </label>
          <button type="submit" disabled={busy} className={BUTTON}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Invite
          </button>
        </form>
        <p className="mt-2 text-[11px] text-white/60">{projectRoleSummary(role, downloadsApply ? downloads : true)}. They see this project only, not the rest of {orgName}.</p>
      </div>

      {failed && !data ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-4 text-[11px] text-white/60" role="alert">
          Could not load the people on this project. Reload to try again.
        </p>
      ) : !data ? (
        <p className="px-1 text-[11px] text-white/40" role="status">Loading…</p>
      ) : data.members.length === 0 && data.invitations.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-5 text-center text-[11px] text-white/40">Nobody outside {orgName} is on this project yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
          {data.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-3" data-testid={`project-member-${m.user_id}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-white/80">{m.name ?? m.email ?? 'Member'}</span>
                <span className="block truncate text-[11px] text-white/40">
                  {m.name && m.email ? `${m.email} · ` : ''}
                  {m.summary ?? ''}
                  {m.expires_at ? ` · ${m.live ? 'until' : 'expired'} ${shortDate(m.expires_at)}` : ''}
                </span>
              </span>
              <Dropdown
                aria-label={`Role of ${m.name ?? m.email ?? 'member'}`}
                value={isExternalProjectRole(m.role) ? m.role : 'viewer'}
                onChange={(v) => void call(`/members/${m.user_id}`, { method: 'PATCH', body: JSON.stringify({ role: v }) }, 'Role changed')}
                options={roleOptions}
                disabled={busy}
              />
              {(m.role === 'viewer' || m.role === 'commenter') && (
                <label className="flex items-center gap-2 text-[11px] text-white/70">
                  <input
                    type="checkbox"
                    checked={m.allow_downloads}
                    disabled={busy}
                    onChange={(e) => void call(`/members/${m.user_id}`, { method: 'PATCH', body: JSON.stringify({ allow_downloads: e.target.checked }) }, 'Downloads updated')}
                    className="h-3.5 w-3.5 accent-white"
                  />
                  Downloads
                </label>
              )}
              <button type="button" onClick={() => void remove(m)} disabled={busy} className={BUTTON} aria-label={`Remove ${m.name ?? m.email ?? 'member'}`}>
                Remove
              </button>
            </li>
          ))}
          {data.invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-3" data-testid={`project-invitation-${i.id}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-white/80">{i.email}</span>
                <span className="block text-[11px] text-white/40">
                  Invited as {isExternalProjectRole(i.role ?? '') ? PROJECT_ROLE_LABELS[i.role as ExternalProjectRole] : 'member'} · expires {shortDate(i.expires_at)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void call(`/invitations/${i.id}`, { method: 'DELETE' }, 'Invitation revoked')}
                className={BUTTON}
                aria-label={`Revoke the invitation to ${i.email}`}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
