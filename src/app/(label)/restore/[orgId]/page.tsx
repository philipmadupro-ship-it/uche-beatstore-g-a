'use client';

/**
 * /restore/<org id> — undo an organization's deletion while its 30-day grace
 * period lasts (LABEL-39, D10). Where the owner lands right after deleting it
 * and where `/o/<slug>` sends them afterwards.
 *
 * Outside any org shell (the org is not live, so there is none), behind
 * LABEL_OS_ENABLED like the other Label OS pages. It asks
 * `GET /api/org/<id>/restore`, which answers only an owner of a soft-deleted
 * org; everyone else gets "nothing to restore", the same words as for an org
 * that never existed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { daysLeftLabel, failureMessage, interpretFailure, longDate } from '@/lib/labelos/org-lifecycle-client';

type Info = { org: { id: string; name: string; slug: string }; deletedAt: string; purgeAfter: string | null; daysLeft: number; canRestore: boolean };
type State =
  | { kind: 'loading' }
  | { kind: 'signin' }
  | { kind: 'nothing' }
  | { kind: 'ready'; info: Info }
  | { kind: 'error'; message: string };

const PRIMARY =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-[#090907] transition-colors hover:bg-white/90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0D0A]';

export default function RestoreOrgPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = typeof params?.orgId === 'string' ? params.orgId : '';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/org/${orgId}/restore`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setState({ kind: 'ready', info: body as Info });
      else if (res.status === 401) setState({ kind: 'signin' });
      else if (res.status === 404 || res.status === 410) setState({ kind: 'nothing' });
      else setState({ kind: 'error', message: failureMessage(interpretFailure(res.status, body)) });
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Reload to try again.' });
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/${orgId}/restore`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.href === 'string') {
        window.location.assign(body.href);
        return;
      }
      setError(failureMessage(interpretFailure(res.status, body)));
      if (res.status === 410 || res.status === 404) void load();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-white">
      <div className="w-full max-w-sm rounded-[20px] border border-white/10 bg-[#0D0D0A] p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Scheduled for deletion</p>
        {state.kind === 'loading' && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-white/70">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…
          </p>
        )}
        {state.kind === 'signin' && (
          <>
            <h1 className="mt-2 font-heading text-2xl leading-tight text-white">Sign in to continue</h1>
            <p className="mt-3 text-sm leading-6 text-white/80">Only an owner of the organization can restore it.</p>
            <a className={`${PRIMARY} mt-6`} href={`/login?next=${encodeURIComponent(`/restore/${orgId}`)}`}>
              Sign in
            </a>
          </>
        )}
        {state.kind === 'nothing' && (
          <>
            <h1 className="mt-2 font-heading text-2xl leading-tight text-white">Nothing to restore</h1>
            <p className="mt-3 text-sm leading-6 text-white/80">
              This organization is not waiting to be deleted, or its 30 days are over, or you are not one of its owners.
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="mt-4 text-sm leading-6 text-[var(--error-text)]">{state.message}</p>
        )}
        {state.kind === 'ready' && (
          <>
            <h1 className="mt-2 font-heading text-2xl leading-tight text-white">{state.info.org.name}</h1>
            <p className="mt-3 text-sm leading-6 text-white/80">
              {state.info.canRestore
                ? `It is hidden from everyone and will be deleted for good on ${longDate(state.info.purgeAfter)} — in ${daysLeftLabel(state.info.daysLeft)}. Restore it and it comes back exactly as it was.`
                : 'The 30 days are over, so this organization can no longer be restored.'}
            </p>
            {state.info.canRestore && (
              <button type="button" className={`${PRIMARY} mt-6`} disabled={busy} onClick={() => void restore()}>
                {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                Restore organization
              </button>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="mt-6 flex items-start gap-2 text-sm leading-5 text-[var(--error-text)]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}
