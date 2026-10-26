'use client';

/**
 * Invite a person who is ALREADY in the directory (LABEL-50), from their row
 * on the Team page:
 *
 *  - `login`: a roster artist who has no login yet gets the invitation route's
 *    role `artist`, limited to that one contact. No contact is created, so the
 *    artist is not duplicated and `max_artists` is not touched.
 *  - `project`: a collaborator is invited to one project as an external
 *    member (LABEL-21). No contact is created, so a known address does not
 *    hit the directory's duplicate-email refusal.
 *
 * The request is built by `lib/labelos/team-roster` and sent by its runner,
 * the same ones the add form uses.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { EXTERNAL_PROJECT_ROLES } from '@/lib/labelos/capabilities';
import { PROJECT_ROLE_LABELS } from '@/lib/labelos/project-members';
import { existingArtistLoginRequest, existingProjectInviteRequest, isEmail } from '@/lib/labelos/team-roster';
import { runFollowUp, type StepResult } from '@/lib/labelos/team-roster-client';
import type { ProjectChoices } from '@/components/labelos/TeamRosterEditor';

// A Dropdown's menu sits at z-200, under this modal's z-240, so the choices here are chips: the same control language, always on top.
const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';
const CHIP = 'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';
const CHIP_OFF = 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]';

export type InviteTarget = { id: string; name: string; email: string | null; mode: 'login' | 'project' };

export function ContactInviteModal({
  orgId,
  target,
  projects,
  onClose,
}: {
  orgId: string;
  target: InviteTarget | null;
  projects: ProjectChoices;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<(typeof EXTERNAL_PROJECT_ROLES)[number]>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(target?.email ?? '');
    setProjectId('');
    setRole('viewer');
    setError(null);
    setBusy(false);
  }, [target]);

  if (!target) return null;
  const login = target.mode === 'login';
  const request = login
    ? existingArtistLoginRequest({ id: target.id, name: target.name }, email)
    : existingProjectInviteRequest({ projectId, email, role });
  const ready = !!request && isEmail(email);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    const results: StepResult[] = [];
    try {
      await runFollowUp((url, init) => fetch(url, init), `/api/org/${orgId}`, request, results);
    } finally {
      setBusy(false);
    }
    const r = results[0];
    if (!r?.ok) {
      setError(r?.message ?? 'Could not send the invitation.');
      return;
    }
    toast.success(r.message, r.label);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={login ? `Invite ${target.name} to sign in` : `Invite ${target.name} to a project`}
      description={
        login
          ? 'They join as an artist and see only their own music. The roster artist is not added again.'
          : 'They join one project as an outside collaborator. Nothing else in the organization is shared.'
      }
      icon={<Mail size={16} aria-hidden="true" />}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="contact-invite-form" loading={busy} disabled={!ready}>
            Send invitation
          </Button>
        </div>
      }
    >
      <form id="contact-invite-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email address" type="email" autoComplete="off" value={email} maxLength={200} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
        {!login &&
          (projects === 'failed' ? (
            <p role="alert" className="text-xs text-[var(--error-text)]">Could not load the projects. Reload to try again.</p>
          ) : (
            <>
              <fieldset>
                <legend className={LEGEND}>Project</legend>
                {projects === null ? (
                  <p role="status" className="text-xs text-white/60">Loading the projects…</p>
                ) : projects.length === 0 ? (
                  <p className="text-xs text-white/60">This organization has no projects yet.</p>
                ) : (
                  <div role="radiogroup" aria-label="Project" className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                    {projects.map((p) => (
                      <button key={p.id} type="button" role="radio" aria-checked={projectId === p.id} disabled={busy} onClick={() => setProjectId(p.id)} className={cn(CHIP, projectId === p.id ? CHIP_ON : CHIP_OFF)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>
              <fieldset>
                <legend className={LEGEND}>They can</legend>
                <div role="radiogroup" aria-label="Project role" className="flex flex-wrap gap-2">
                  {EXTERNAL_PROJECT_ROLES.map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={role === r} disabled={busy} onClick={() => setRole(r)} className={cn(CHIP, role === r ? CHIP_ON : CHIP_OFF)}>
                      {PROJECT_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ))}
        {error && (
          <p role="alert" className="text-xs leading-5 text-[var(--error-text)]">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
