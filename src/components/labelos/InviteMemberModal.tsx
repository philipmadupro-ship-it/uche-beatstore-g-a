'use client';

/**
 * The one invite dialog (LABEL-08, 14 "UX: One modal for invite"). Mounted
 * by the members page (LABEL-09); it knows nothing of where it lives, only
 * the org it invites to.
 *
 * Built on `ui/Modal` (focus trap, Escape, focus restore — what
 * `useDialogBehavior` gives hand-rolled overlays). The choices it offers come
 * from the same rules the route enforces (`invitableRoles` /
 * `invitableFunctions`, lib/labelos/invitations.ts), so the form never offers
 * something the server would refuse. Artist scoping (`contact_ids`) is not
 * offered here yet: the roster picker is LABEL-10.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { ROLE_USES_FUNCTIONS, type OrgFunction, type OrgKind } from '@/lib/labelos/capabilities';
import {
  FUNCTION_LABELS,
  ROLE_LABELS,
  invitableFunctions,
  invitableRoles,
  type InvitableRole,
} from '@/lib/labelos/invitations';

export type CreatedInvitation = {
  id: string;
  email: string;
  role: string;
  functions: string[];
  contact_ids: string[];
  expires_at: string;
};

const ROLE_HINTS: Readonly<Record<InvitableRole, string>> = {
  admin: 'Runs the organization: everything except deleting it.',
  member: 'Staff. What they can do comes from their functions.',
  artist: 'A roster artist. Sees their own music, never business notes.',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteMemberModal({
  open,
  onClose,
  orgId,
  orgKind,
  orgName,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  orgKind: OrgKind;
  orgName: string;
  onInvited?: (invitation: CreatedInvitation) => void;
}) {
  const roles = invitableRoles(orgKind);
  const functions = invitableFunctions(orgKind);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('member');
  const [picked, setPicked] = useState<OrgFunction[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; emailSent: boolean } | null>(null);

  // Every opening starts clean.
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('member');
    setPicked([]);
    setError(null);
    setSent(null);
    setSubmitting(false);
  }, [open]);

  const usesFunctions = ROLE_USES_FUNCTIONS[role];
  const emailValid = EMAIL_RE.test(email.trim());

  const toggle = (fn: OrgFunction) =>
    setPicked((cur) => (cur.includes(fn) ? cur.filter((f) => f !== fn) : [...cur, fn]));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!emailValid) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/${orgId}/invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, functions: usesFunctions ? picked : [] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        invitation?: CreatedInvitation;
        emailSent?: boolean;
      };
      if (!res.ok || !body.invitation) {
        setError(body.error ?? 'Could not send the invitation.');
        return;
      }
      setSent({ email: body.invitation.email, emailSent: body.emailSent === true });
      onInvited?.(body.invitation);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite to organization"
      description={`They join ${orgName} when they accept with this email address.`}
      icon={<UserPlus size={16} aria-hidden="true" />}
      size="md"
      footer={
        sent ? (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="invite-member-form" loading={submitting} disabled={!emailValid}>
              Send invitation
            </Button>
          </div>
        )
      }
    >
      {sent ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#6DC6A4]" aria-hidden="true" />
          <div className="min-w-0 text-xs leading-5">
            <p className="text-white/80">Invitation created for {sent.email}.</p>
            <p className="mt-1 text-[var(--text-readable)]">
              {sent.emailSent
                ? 'The link is in their inbox and works once, for 7 days.'
                : 'The email could not be sent. Revoke this invitation and send a new one.'}
            </p>
          </div>
        </div>
      ) : (
        <form id="invite-member-form" onSubmit={submit} className="space-y-6" noValidate>
          <Field
            label="Email address"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            disabled={submitting}
          />

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Role</legend>
            <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  disabled={submitting}
                  onClick={() => setRole(r)}
                  className={cn(
                    'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40',
                    role === r
                      ? 'border-white/30 bg-white/[0.14] text-white'
                      : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]',
                  )}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--text-readable)]">{ROLE_HINTS[role]}</p>
          </fieldset>

          {usesFunctions && functions.length > 0 && (
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Functions</legend>
              <div className="flex flex-wrap gap-2">
                {functions.map((fn) => {
                  const on = picked.includes(fn);
                  return (
                    <button
                      key={fn}
                      type="button"
                      aria-pressed={on}
                      disabled={submitting}
                      onClick={() => toggle(fn)}
                      className={cn(
                        'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40',
                        on
                          ? 'border-white/30 bg-white/[0.14] text-white'
                          : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]',
                      )}
                    >
                      {FUNCTION_LABELS[fn]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--text-readable)]">
                {picked.length === 0 ? 'Without a function they join with no access until one is added.' : 'Each function adds what that job needs.'}
              </p>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-xs leading-5 text-[var(--error-text)]">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
