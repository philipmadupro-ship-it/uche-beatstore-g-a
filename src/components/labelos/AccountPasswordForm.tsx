'use client';

/**
 * The /account/password form (doc 25): a team account sets its own password
 * through POST /api/org/account/password, then opens its organization. The
 * rule shown live is the server's (`passwordProblem`).
 */
import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { PASSWORD_MIN, passwordProblem } from '@/lib/labelos/team-accounts';

const INPUT =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[13px] text-white placeholder-white/30 transition-colors focus:border-white/30 focus:outline-none disabled:opacity-40';
const LABEL = 'mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';

export function AccountPasswordForm({ email, required }: { email: string | null; required: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = password ? passwordProblem(password, email) : null;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = passwordProblem(password, email);
    if (p) return setError(p);
    if (confirm !== password) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const res = await fetch('/api/org/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not change the password. Try again.');
        setBusy(false);
        return;
      }
      // A full load, not router.push: the org shell must re-read on the server that the change is done.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/o');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-sm space-y-6 rounded-[20px] border border-white/10 bg-[#0D0D0A] p-6 sm:p-8" data-testid="account-password-form">
      <header>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{required ? 'Before you start' : 'Your account'}</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white">Choose your password</h1>
        <p className="mt-2 text-[11px] leading-relaxed text-white/60">
          {required
            ? 'You signed in with a password your organization set. Choose your own: nobody else will know it.'
            : 'Set a new password for this account.'}
          {email ? ` Signed in as ${email}.` : ''}
        </p>
      </header>

      <div>
        <label htmlFor="new-password" className={LABEL}>New password</label>
        <div className="relative">
          <input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder={`At least ${PASSWORD_MIN} characters`}
            className={`${INPUT} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-white/60 hover:text-white focus:outline-none focus-visible:text-white"
          >
            {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        {problem && <p className="mt-1.5 text-[11px] text-[var(--error-text)]">{problem}</p>}
      </div>

      <div>
        <label htmlFor="confirm-password" className={LABEL}>Type it again</label>
        <input
          id="confirm-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          className={INPUT}
        />
        {mismatch && <p className="mt-1.5 text-[11px] text-[var(--error-text)]">The two passwords are not the same.</p>}
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-[#8d3a2f]/60 bg-[#8d3a2f]/15 px-3 py-2 text-[11px] text-[#ffb7a8]">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? 'Saving…' : 'Save and continue'}
      </button>
    </form>
  );
}
