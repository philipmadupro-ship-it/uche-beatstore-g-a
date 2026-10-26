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
import { Button } from '@/components/ui/Button';
import { TeamRosterResults } from '@/components/labelos/TeamRosterResults';
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

      <TeamRosterResults results={results} />

      <Button variant="primary" className="w-full" onClick={onOpen}>Open your workspace</Button>
    </div>
  );
}
