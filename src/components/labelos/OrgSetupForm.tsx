'use client';

/**
 * The /setup form (LABEL-48, first slice): pick the face, name the org,
 * create it through POST /api/org/setup, then open it. Roster, departments
 * and contract types are later wizard steps (doc 23, LABEL-48/50); they stay
 * editable in the org once it exists.
 */
import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { AccountFacePicker } from '@/components/labelos/AccountFacePicker';
import { BUYER_HOME, FACE_COPY, SETUP_NAME_MAX, cleanOrgName, type SetupFace } from '@/lib/labelos/setup';

export function OrgSetupForm({ initialFace, email }: { initialFace: SetupFace | null; email: string | null }) {
  const [face, setFace] = useState<SetupFace | null>(initialFace);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!face) {
      setError('Choose what kind of account this is.');
      return;
    }
    const clean = cleanOrgName(name);
    if (!clean) {
      setError(`Give it a name of 1 to ${SETUP_NAME_MAX} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/org/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ face, name: clean }),
      });
      const body = (await res.json().catch(() => ({}))) as { home?: string; error?: string };
      if (!res.ok || typeof body.home !== 'string') {
        setError(body.error ?? 'Could not set up the organization. Try again.');
        setBusy(false);
        return;
      }
      // Hard navigation: the proxy must see the new membership on a fresh request.
      window.location.assign(body.home);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  const copy = face ? FACE_COPY[face] : null;

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-lg space-y-6 rounded-[20px] border border-white/10 bg-[#0D0D0A] p-6 sm:p-8"
      data-testid="org-setup-form"
      noValidate
    >
      <header>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Set up your account</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px]">Who are you?</h1>
        {email ? <p className="mt-2 text-[12px] text-white/60">Signed in as {email}</p> : null}
      </header>

      <AccountFacePicker value={face} onChange={setFace} disabled={busy} legend="Account type" />

      <div>
        <label htmlFor="org-name" className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {copy?.nameLabel ?? 'Name'}
        </label>
        <input
          id="org-name"
          type="text"
          value={name}
          maxLength={SETUP_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder={copy?.namePlaceholder ?? ''}
          className="w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[13px] text-white placeholder-white/30 transition-colors focus:border-white/30 focus:outline-none disabled:opacity-40"
        />
        <p className="mt-1.5 text-[11px] text-white/60">
          {face === 'label'
            ? 'You will add your artists, producers and team from the label once it is created.'
            : face === 'independent'
              ? 'You are the artist of this workspace. Collaborators can be added later.'
              : 'You can rename it later.'}
        </p>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-[#8d3a2f]/60 bg-[#8d3a2f]/15 px-3 py-2 text-[12px] text-[#ffb7a8]">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-[12px] font-semibold uppercase tracking-widest text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? 'Creating…' : face === 'label' ? 'Create label' : 'Create workspace'}
      </button>

      <p className="text-center text-[11px] text-white/60">
        Only here to buy beats?{' '}
        <a href={BUYER_HOME} className="text-white/80 underline-offset-2 hover:text-white hover:underline">
          Go to your buyer account
        </a>
      </p>
    </form>
  );
}
