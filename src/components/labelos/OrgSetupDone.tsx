'use client';

/**
 * The wizard's last screen (LABEL-48): what was created, what was not, and
 * the passwords of any team logins — shown ONCE.
 *
 * The passwords live only in the `results` this component is given (React
 * state in the wizard): never localStorage, never a URL, gone when the screen
 * is left. Supabase keeps only a hash, so this is the creator's only chance to
 * copy them (same pattern as the members page, doc 25).
 *
 * `existing` is the lost-response case: the account already had an organization
 * (a retry after a response that never arrived), so NOTHING the wizard
 * collected was applied. The screen says so plainly and links to where each
 * thing is added by hand.
 */
import { useRef, useEffect } from 'react';
import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import type { StepResult } from '@/lib/labelos/setup-wizard-client';

const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';

export const EXISTING_NOT_ADDED =
  'This account already has an organization, so the roster artists, invitations, team logins and first release you entered in this wizard were NOT added, and its settings were not changed.';

export function OrgSetupDone({
  home,
  results,
  existing = false,
  onOpen,
}: {
  home: string;
  results: StepResult[];
  existing?: boolean;
  onOpen: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const failed = results.filter((r) => !r.ok);
  const logins = results.filter((r) => r.ok && r.kind === 'login' && r.password);

  const copy = async (text: string) => {
    if (await copyToClipboard(text)) toast.success('Copied');
    else toast.error('Could not copy');
  };

  return (
    <div className="w-full max-w-2xl space-y-6 rounded-[20px] border border-white/10 bg-[#0D0D0A] p-6 sm:p-8" data-testid="wizard-done">
      <header>
        <p className={`${LEGEND} mb-2`}>{existing ? 'Nothing was added' : 'Your account is ready'}</p>
        <h1 ref={heading} tabIndex={-1} className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white focus:outline-none sm:text-[32px]">
          {existing ? 'You already have an organization' : failed.length === 0 ? 'All set' : 'Set up, with a few things left'}
        </h1>
        <p className="mt-2 text-[11px] leading-relaxed text-white/60" data-testid="wizard-done-note">
          {existing
            ? EXISTING_NOT_ADDED
            : failed.length === 0
              ? 'Everything you added is in place.'
              : 'The organization exists. These did not go through; each can be done from the place named.'}
        </p>
      </header>

      {existing ? (
        <ul className="space-y-2 text-[13px]" data-testid="wizard-existing-links">
          <li><a className="text-white/80 underline-offset-2 hover:text-white hover:underline" href={`${home}/settings/members`}>Members: invite people or create logins</a></li>
          <li><a className="text-white/80 underline-offset-2 hover:text-white hover:underline" href={`${home}/artists`}>Artists: add to the roster</a></li>
          <li><a className="text-white/80 underline-offset-2 hover:text-white hover:underline" href={`${home}/releases`}>Releases: start a draft</a></li>
        </ul>
      ) : null}

      {results.length > 0 ? (
        <ul className="divide-y divide-white/10" data-testid="wizard-results">
          {results.map((r, i) => (
            <li key={i} className="flex items-start gap-3 py-3" data-testid={r.ok ? 'result-ok' : 'result-failed'}>
              {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#6DC6A4]" aria-hidden="true" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-[#ffb7a8]" aria-hidden="true" />}
              <div className="min-w-0 text-[13px] leading-relaxed">
                <p className="break-words text-white/80">{r.label}</p>
                <p className="text-[11px] text-white/60">{r.ok ? r.message : `${r.message} Do it in ${r.fixIn}.`}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {logins.length > 0 ? (
        <section aria-labelledby="logins-h" data-testid="wizard-logins" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <h2 id="logins-h" className={LEGEND}>Passwords for the logins you created</h2>
          <p className="text-[11px] leading-relaxed text-white/70">
            Shown once. They are not saved anywhere and cannot be shown again once you leave this screen. Copy them now and hand them over; each person is asked to choose their own on first sign-in.
          </p>
          <ul className="space-y-2">
            {logins.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="wizard-login">
                <span className="min-w-0 break-all text-[13px] text-white/80">{r.label}</span>
                <code className="break-all font-mono text-[11px] text-white" data-testid="wizard-login-password">{r.password}</code>
                <Button variant="secondary" size="sm" onClick={() => copy(`${r.label}\n${r.password}`)} aria-label={`Copy the login for ${r.label}`}>
                  <Copy size={14} aria-hidden="true" /> Copy
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button variant="primary" className="w-full" onClick={onOpen}>Open your workspace</Button>
    </div>
  );
}
