'use client';

/**
 * What an Add did (LABEL-50): one line per request — added, or why not and
 * where to do it by hand — and the passwords of any team logins that were
 * created, shown ONCE. Used by the setup wizard's last screen and by the Team
 * page, so a result reads the same in both.
 *
 * The passwords live only in the `results` this component is given (React
 * state in the host): never localStorage, never a URL, gone when the screen is
 * left. Supabase keeps only a hash, so this is the creator's only chance to
 * copy them (doc 25).
 */
import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import type { StepResult } from '@/lib/labelos/team-roster-client';

const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';

export function TeamRosterResults({ results }: { results: StepResult[] }) {
  const logins = results.filter((r) => r.ok && r.kind === 'login' && r.password);

  const copy = async (text: string) => {
    if (await copyToClipboard(text)) toast.success('Copied');
    else toast.error('Could not copy');
  };

  return (
    <>
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

    </>
  );
}
