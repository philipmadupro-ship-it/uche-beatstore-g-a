'use client';

/**
 * Export and deletion for one organization (LABEL-39), owners only. Lives at
 * `/o/<slug>/settings/data`, reached from the members page.
 *
 * Both acts need a recent sign-in (the routes answer 403 `requiresReauth`
 * otherwise). The panel turns that answer into "send me a sign-in link": a
 * fresh magic link to the owner's own address, returning to this page. It
 * never asks for a password and never tries to guess whether the sign-in is
 * recent; the server decides, the panel reacts.
 *
 * Deleting follows the interaction ladder's heaviest rung on purpose:
 * type the organization's name, then `confirmToast`. The route re-checks the
 * name, the owner and the sign-in, so none of this is the safeguard — it is
 * the pause. After it the owner is sent to the restore page, which is where
 * the 30-day countdown lives.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { confirmToast, toast } from '@/hooks/useToast';
import { createClient } from '@/lib/supabase/client';
import { GRACE_DAYS, REAUTH_WINDOW_MINUTES } from '@/lib/labelos/org-lifecycle';
import {
  DELETE_EXPLAINER,
  canSubmitDelete,
  failureMessage,
  fileNameFromDisposition,
  interpretFailure,
} from '@/lib/labelos/org-lifecycle-client';
import { canDeleteOrgKind } from '@/lib/labelos/org-lifecycle';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-5 sm:p-6';

type Org = { id: string; name: string; slug: string; kind: string };

/** `exportable`: the org is licensed for the export module (LABEL-47); without it the export section is not drawn. */
export function OrgDataPanel({ org, isOwner, exportable = true }: { org: Org; isOwner: boolean; exportable?: boolean }) {
  const [email, setEmail] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState<'json' | 'csv' | 'delete' | 'link' | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (alive) setEmail(data.user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const sendLink = useCallback(async () => {
    if (!email) {
      setError('We could not read your email address. Sign out and back in, then try again.');
      return;
    }
    setBusy('link');
    setError(null);
    const here = `/o/${org.slug}/settings/data`;
    const { error: otpErr } = await createClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(here)}`,
      },
    });
    setBusy(null);
    if (otpErr) setError(otpErr.message);
    else setLinkSent(true);
  }, [email, org.slug]);

  const handleFailure = (status: number, body: unknown) => {
    const failure = interpretFailure(status, body);
    if (failure.kind === 'reauth') setNeedsReauth(true);
    setError(failureMessage(failure));
  };

  const download = async (format: 'json' | 'csv') => {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(`/api/org/${org.id}/export?format=${format}`, { cache: 'no-store' });
      if (!res.ok) {
        handleFailure(res.status, await res.json().catch(() => ({})));
        return;
      }
      const blob = await res.blob();
      const name = fileNameFromDisposition(res.headers.get('content-disposition'), `${org.slug}-export.${format === 'csv' ? 'zip' : 'json'}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded', 'Audio and files are not inside it — the manifest lists their keys.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirmToast(
      `Delete ${org.name}?`,
      `It is hidden from everyone now and deleted for good in ${GRACE_DAYS} days.`,
      { confirmLabel: 'Delete organization', danger: true },
    );
    if (!ok) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/org/${org.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName: typed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        handleFailure(res.status, body);
        return;
      }
      // A full load: the proxy and the shell must see the org as gone.
      window.location.assign(typeof body.restoreUrl === 'string' ? body.restoreUrl : '/');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!isOwner) {
    return (
      <section className={CARD} aria-labelledby="org-data-owner-only">
        <p id="org-data-owner-only" className={LABEL}>Owners only</p>
        <p className="mt-3 text-sm leading-6 text-white/70">
          Exporting and deleting an organization are acts of its owners. Ask an owner of {org.name} if you need a copy of its data.
        </p>
      </section>
    );
  }

  const deletable = canDeleteOrgKind(org.kind);

  return (
    <div className="space-y-6">
      {(needsReauth || linkSent) && (
        <section className={CARD} aria-live="polite">
          <p className={LABEL}>Confirm it is you</p>
          {linkSent ? (
            <p className="mt-3 text-sm leading-6 text-white/80">
              We sent a sign-in link to {email}. Open it on this device — it brings you back here — then try again. It counts for {REAUTH_WINDOW_MINUTES} minutes.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm leading-6 text-white/80">
                Exporting or deleting an organization needs a sign-in from the last {REAUTH_WINDOW_MINUTES} minutes. We will email {email ?? 'you'} a fresh link.
              </p>
              <Button className="mt-4" variant="secondary" size="sm" loading={busy === 'link'} disabled={!email} onClick={() => void sendLink()}>
                <Mail size={14} aria-hidden="true" />
                Send me a sign-in link
              </Button>
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--error-text)]">
          {error}
        </p>
      )}

      {exportable && <section className={CARD} aria-labelledby="org-export-heading">
        <p id="org-export-heading" className={LABEL}>Export</p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
          A copy of everything {org.name} holds: members, people, projects, songs, comments, tasks, releases and the activity history. Audio and files are not inside it; a manifest lists
          the key of every object so you can fetch them before anything is deleted.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" loading={busy === 'json'} disabled={busy !== null} onClick={() => void download('json')}>
            <Download size={14} aria-hidden="true" />
            Download JSON
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'csv'} disabled={busy !== null} onClick={() => void download('csv')}>
            <Download size={14} aria-hidden="true" />
            Download CSV (zip)
          </Button>
        </div>
      </section>}

      <section className="rounded-xl border border-[#5a241c] bg-[#0D0D0A] p-5 sm:p-6" aria-labelledby="org-danger-heading">
        <p id="org-danger-heading" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--error-text)]">
          <AlertTriangle size={12} aria-hidden="true" />
          Danger zone
        </p>
        {deletable ? (
          <>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{DELETE_EXPLAINER}</p>
            <label htmlFor="org-delete-confirm" className="mt-4 block text-sm text-white/80">
              Type <span className="font-medium text-white">{org.name}</span> to confirm
            </label>
            <input
              id="org-delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 min-h-11 w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            />
            <div className="mt-4">
              <Button variant="danger" size="sm" loading={busy === 'delete'} disabled={busy !== null || !canSubmitDelete(typed, org.name)} onClick={() => void remove()}>
                Delete this organization…
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
            This is your producer workspace. It is not deleted from here; your producer account and everything in it are managed from Settings.
          </p>
        )}
      </section>
    </div>
  );
}
