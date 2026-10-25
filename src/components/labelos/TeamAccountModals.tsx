'use client';

/**
 * Team accounts (docs/bstudio-label-os/25-team-accounts.md, phase 1): the
 * dialog an owner or admin uses to give an account a new password. Creating a
 * login is part of the Team and roster window (LABEL-50, TeamRosterEditor).
 *
 * It shows the password ONCE, after it is set, with a Copy button — the app
 * never stores it and cannot show it again (Supabase keeps only a hash).
 * Built on `ui/Modal` (focus trap, Escape, focus restore).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { PASSWORD_MIN, generatePassword, passwordProblem } from '@/lib/labelos/team-accounts';

function freshPassword(): string {
  return generatePassword((n) => crypto.getRandomValues(new Uint32Array(n)));
}


/** The password field with Generate; shows the text so the manager can read it out or copy it. */
function PasswordInput({ value, onChange, disabled, email }: { value: string; onChange: (v: string) => void; disabled: boolean; email?: string }) {
  const problem = value ? passwordProblem(value, email) : null;
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label="Password"
            type="text"
            autoComplete="new-password"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={`At least ${PASSWORD_MIN} characters`}
          />
        </div>
        <Button variant="secondary" size="sm" type="button" onClick={() => onChange(freshPassword())} disabled={disabled}>
          <RefreshCw size={14} aria-hidden="true" />
          Generate
        </Button>
      </div>
      <p className={cn('mt-2 text-xs leading-5', problem ? 'text-[var(--error-text)]' : 'text-[var(--text-readable)]')}>
        {problem ?? 'They are asked to choose their own at first sign-in.'}
      </p>
    </div>
  );
}

/** Shown once, after the password is set. */
function Handover({ title, email, password }: { title: string; email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.04] p-4" data-testid="team-account-handover">
      <p className="flex items-center gap-2 text-xs text-white/80">
        <CheckCircle2 size={16} className="shrink-0 text-[#6DC6A4]" aria-hidden="true" />
        {title}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-white/60">Email</dt>
        <dd className="truncate text-white/80">{email}</dd>
        <dt className="text-white/60">Password</dt>
        <dd className="break-all font-mono text-white" data-testid="team-account-password">{password}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={async () => setCopied(await copyToClipboard(`${email}\n${password}`))}
        >
          <Copy size={14} aria-hidden="true" />
          {copied ? 'Copied' : 'Copy sign-in details'}
        </Button>
      </div>
      <p className="text-xs leading-5 text-[var(--text-readable)]">
        Give these to them now: this password is not shown again. They sign in at the usual sign-in page and choose their own password.
        If it is lost, reset it from the member’s menu.
      </p>
    </div>
  );
}

export function ResetPasswordModal({
  open,
  onClose,
  orgId,
  member,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  member: { user_id: string; label: string; email: string | null } | null;
  onReset?: (userId: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword(freshPassword());
    setError(null);
    setDone(null);
    setSubmitting(false);
  }, [open]);

  if (!member) return null;
  const ready = !passwordProblem(password, member.email);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/${orgId}/team-accounts/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not reset the password.');
        return;
      }
      setDone(password);
      onReset?.(member.user_id);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const footer: ReactNode = done ? (
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
      <Button variant="primary" size="sm" type="submit" form="reset-password-form" loading={submitting} disabled={!ready}>
        Set new password
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New password for ${member.label}`}
      description="Their old password stops working. They are asked to choose their own at next sign-in."
      icon={<KeyRound size={16} aria-hidden="true" />}
      size="md"
      footer={footer}
    >
      {done ? (
        <Handover title="Password changed." email={member.email ?? member.label} password={done} />
      ) : (
        <form id="reset-password-form" onSubmit={submit} className="space-y-4" noValidate>
          <PasswordInput value={password} onChange={setPassword} disabled={submitting} email={member.email ?? undefined} />
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
