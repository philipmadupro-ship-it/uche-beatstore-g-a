'use client';

/**
 * The /setup wizard (LABEL-48): Who are you · How you work · Team and roster
 * · Departments · Review and create. Replaces the one-screen form of the
 * first slice; same page, same route.
 *
 * Nothing exists until "Create". The state is one draft
 * (lib/labelos/setup-wizard), saved to localStorage under the account's id so
 * a closed tab resumes where it was, and cleared on success. Storage may be
 * blocked (private windows), and then the wizard just starts clean.
 *
 * All rules are in lib/labelos/setup-wizard*.ts; this file draws them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { AccountFacePicker } from '@/components/labelos/AccountFacePicker';
import { OrgSetupDone } from '@/components/labelos/OrgSetupDone';
import { TeamRosterEditor } from '@/components/labelos/TeamRosterEditor';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dropdown } from '@/components/ui/Dropdown';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS, TEMPLATES_LATER } from '@/lib/labelos/contract-types';
import { RELEASE_TYPES } from '@/lib/labelos/releases';
import { BUYER_HOME, FACE_COPY, SETUP_NAME_MAX, kindForFace, type SetupFace } from '@/lib/labelos/setup';
import { availableAdds, rosterWording } from '@/lib/labelos/team-roster';
import {
  DEPARTMENT_CHOICES,
  WIZARD_STEPS,
  clearDraft,
  departmentsOn,
  effectiveGates,
  firstBlockedStep,
  isUntouched,
  loadDraft,
  newDraft,
  nextStep,
  previousStep,
  rosterNames,
  saveDraft,
  skipStep,
  stepIndex,
  stepProblems,
  withContractType,
  withDepartment,
  withFace,
  type WizardDraft,
  type WizardStepId,
} from '@/lib/labelos/setup-wizard';
import { runSetup, type StepResult } from '@/lib/labelos/setup-wizard-client';

const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function CheckRow({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Checkbox id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13px] text-white/80">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-white/60">{hint}</span>
      </label>
    </div>
  );
}

function Summary({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn(LEGEND, 'mb-1')}>{label}</p>
        <div className="text-[13px] leading-relaxed text-white/80">{children}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${label}`}>Edit</Button>
    </div>
  );
}

export function OrgSetupWizard({ userId, initialFace, email }: { userId: string; initialFace: SetupFace | null; email: string | null }) {
  const [draft, setDraft] = useState<WizardDraft>(() => newDraft(initialFace));
  const [ready, setReady] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ home: string; results: StepResult[]; existing?: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Resume after mount: localStorage does not exist on the server render.
  useEffect(() => {
    const saved = loadDraft(storage(), userId);
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage is client-only, so the draft can only be read after mount */
    if (saved && !isUntouched(saved)) {
      setDraft(initialFace && !saved.face ? withFace(saved, initialFace) : saved);
      setResumed(true);
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [userId, initialFace]);

  useEffect(() => {
    if (ready && !outcome) saveDraft(storage(), userId, draft);
  }, [ready, outcome, userId, draft]);

  // Each step change moves focus to its heading, for keyboard and screen-reader users.
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [draft.step, ready, outcome]);

  const update = useCallback((next: WizardDraft) => {
    setShown([]);
    setError(null);
    setDraft(next);
  }, []);

  const go = (step: WizardStepId) => update({ ...draft, step });

  const advance = () => {
    const problems = stepProblems(draft, draft.step);
    if (problems.length > 0) {
      setShown(problems);
      return;
    }
    go(nextStep(draft.step));
  };

  const skip = () => update({ ...skipStep(draft, draft.step), step: nextStep(draft.step) });

  const startOver = () => {
    clearDraft(storage(), userId);
    setResumed(false);
    update(newDraft(initialFace));
  };

  const create = async () => {
    const blocked = firstBlockedStep(draft);
    if (blocked) {
      setShown(stepProblems(draft, blocked));
      setDraft({ ...draft, step: blocked });
      return;
    }
    setBusy(true);
    setError(null);
    const run = await runSetup(draft, (url, init) => fetch(url, init));
    if (run.status === 'failed') {
      setError(run.error);
      setBusy(false);
      return;
    }
    clearDraft(storage(), userId);
    const results = run.status === 'created' ? run.results : [];
    if (run.status === 'exists') {
      // Settings are not an edit of an existing org: say so instead of dropping what was entered silently.
      setOutcome({ home: run.home, results: [], existing: true });
      setBusy(false);
      return;
    }
    if (results.length === 0) {
      // Hard navigation: the proxy must see the new membership on a fresh request.
      window.location.assign(run.home);
      return;
    }
    setOutcome({ home: run.home, results });
    setBusy(false);
  };

  const face = draft.face;
  const copy = face ? FACE_COPY[face] : null;
  const index = stepIndex(draft.step);
  const step = WIZARD_STEPS[index];
  const gates = effectiveGates(draft);
  const isLast = draft.step === 'review';

  if (outcome) {
    return <OrgSetupDone home={outcome.home} results={outcome.results} existing={outcome.existing} onOpen={() => window.location.assign(outcome.home)} />;
  }

  return (
    <div className="w-full max-w-2xl space-y-6 rounded-[20px] border border-white/10 bg-[#0D0D0A] p-6 sm:p-8" data-testid="org-setup-wizard">
      <header>
        <p className={cn(LEGEND, 'mb-2')}>Set up your account · Step {index + 1} of {WIZARD_STEPS.length}</p>
        <h1 ref={heading} tabIndex={-1} className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white focus:outline-none sm:text-[32px]">
          {draft.step === 'who' ? 'Who are you?' : step.title}
        </h1>
        {email ? <p className="mt-2 text-[11px] text-white/60">Signed in as {email}</p> : null}
        <ol className="mt-4 flex gap-1.5" aria-label="Progress">
          {WIZARD_STEPS.map((s, i) => (
            <li key={s.id} className="flex-1">
              <span className="sr-only">{`${s.title}${i < index ? ', done' : i === index ? ', current' : ''}`}</span>
              <span aria-hidden="true" className={cn('block h-1 rounded-full', i <= index ? 'bg-white/60' : 'bg-white/10')} />
            </li>
          ))}
        </ol>
      </header>

      {resumed ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70" data-testid="wizard-resumed">
          Picked up where you left off. Nothing has been created yet.
          <button type="button" onClick={startOver} className="underline-offset-2 hover:text-white hover:underline">Start over</button>
        </p>
      ) : null}

      {draft.step === 'who' ? (
        <div className="space-y-6">
          <AccountFacePicker value={face} onChange={(f) => update(withFace(draft, f))} disabled={busy} legend="Account type" />
          <div>
            <label htmlFor="org-name" className={cn(LEGEND, 'mb-1 block')}>{copy?.nameLabel ?? 'Name'}</label>
            <input
              id="org-name"
              type="text"
              value={draft.name}
              maxLength={SETUP_NAME_MAX}
              onChange={(e) => update({ ...draft, name: e.target.value })}
              placeholder={copy?.namePlaceholder ?? ''}
              className="w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[13px] text-white placeholder-white/30 transition-colors focus:border-white/30 focus:outline-none disabled:opacity-40"
            />
            <p className="mt-1.5 text-[11px] text-white/60">
              {face === 'label'
                ? 'The next steps add your artists and team; every one of them can be skipped.'
                : face === 'independent'
                  ? 'You are the artist of this workspace. Collaborators can be added later.'
                  : 'You can rename it later.'}
            </p>
          </div>
        </div>
      ) : null}

      {draft.step === 'work' ? (
        <section aria-labelledby="work-h">
          <h2 id="work-h" className={LEGEND}>Contract types you use</h2>
          <p className="text-[11px] leading-relaxed text-white/60">Pick the agreements you work with. {TEMPLATES_LATER}</p>
          <div className="divide-y divide-white/10" data-testid="wizard-contract-types">
            {CONTRACT_TYPES.map((t) => (
              <CheckRow key={t.id} id={`ct-${t.id}`} label={t.label} hint={draft.contractTypes.includes(t.id) ? 'Used' : 'Not used'} checked={draft.contractTypes.includes(t.id)} onChange={(v) => update(withContractType(draft, t.id, v))} />
            ))}
          </div>
        </section>
      ) : null}

      {draft.step === 'team' && draft.face ? (
        <TeamRosterEditor
          orgKind={kindForFace(draft.face)}
          entries={{ artists: draft.roster, people: draft.team, collaborators: draft.collaborators }}
          onChange={(e) => update({ ...draft, roster: e.artists, team: e.people, collaborators: e.collaborators })}
          disabled={busy}
          adds={availableAdds(kindForFace(draft.face), { members: true, catalog: true, wholeOrg: true, external: false })}
          testId="wizard-team"
          soloNoteTestId="wizard-solo-note"
        />
      ) : null}

      {draft.step === 'departments' ? (
        <section aria-labelledby="dept-h">
          <h2 id="dept-h" className={LEGEND}>Departments</h2>
          <p className="text-[11px] leading-relaxed text-white/60">
            {face === 'label' ? 'A label starts with every department on.' : 'Working alone, you start with the ones you are likely to use.'} Switch one off and its pages are hidden; the owner can change this any time in Organization settings.
          </p>
          <div className="divide-y divide-white/10" data-testid="wizard-departments">
            {DEPARTMENT_CHOICES.map((d) => (
              <CheckRow key={d.module} id={`dept-${d.module}`} label={d.label} hint={d.hint} checked={!draft.departmentsOff.includes(d.module)} onChange={(v) => update(withDepartment(draft, d.module, v))} />
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/50">A&amp;R, producers and collaborators are people, not departments: they are the functions you give team members.</p>
        </section>
      ) : null}

      {draft.step === 'review' ? (
        <div className="space-y-6" data-testid="wizard-review">
          <div className="divide-y divide-white/10">
            <Summary label="Account" onEdit={() => go('who')}>
              {copy?.title}: <span className="text-white">{draft.name.trim()}</span>
            </Summary>
            <Summary label="Contract types" onEdit={() => go('work')}>
              {draft.contractTypes.length > 0 ? draft.contractTypes.map((id) => CONTRACT_TYPE_LABELS[id]).join(', ') : 'None chosen'}
            </Summary>
            <Summary label={face === 'label' ? 'Roster and team' : 'Team'} onEdit={() => go('team')}>
              {face === 'label' ? <p>{rosterNames(draft).length > 0 ? `Artists: ${rosterNames(draft).join(', ')}` : 'No artists yet'}</p> : null}
              <p>
                {draft.team.filter((t) => t.email.trim()).length > 0
                  ? draft.team.filter((t) => t.email.trim()).map((t) => `${t.email.trim()} (${t.mode === 'login' ? 'login' : 'invitation'})`).join(', ')
                  : 'No one else yet'}
              </p>
              {draft.collaborators.some((c) => c.name.trim()) ? (
                <p>{`${rosterWording(kindForFace(draft.face ?? 'independent')).collaborators}: ${draft.collaborators.filter((c) => c.name.trim()).map((c) => c.name.trim()).join(', ')}`}</p>
              ) : null}
            </Summary>
            <Summary label="Departments on" onEdit={() => go('departments')}>
              {departmentsOn(draft).map((m) => DEPARTMENT_CHOICES.find((d) => d.module === m)?.label).join(', ') || 'None'}
            </Summary>
          </div>

          <section aria-labelledby="gates-h">
            <h2 id="gates-h" className={LEGEND}>Default release approvals</h2>
            <p className="text-[11px] leading-relaxed text-white/60">Metadata, artwork, masters and credits &amp; splits always gate. These two are yours to require or skip.</p>
            <div className="divide-y divide-white/10">
              <CheckRow id="gate-legal" label="Require legal approval" hint={gates.legalForcedOff ? 'Off because Contracts & legal is off: nobody could give it.' : 'Off is an explicit skip, shown on every release it affects.'} checked={gates.legal_gate === 'on'} disabled={gates.legalForcedOff} onChange={(v) => update({ ...draft, legalGate: v ? 'on' : 'off' })} />
              <CheckRow id="gate-marketing" label="Require marketing approval" hint="Off skips the marketing sign-off on a release." checked={gates.marketing_gate === 'on'} onChange={(v) => update({ ...draft, marketingGate: v ? 'on' : 'off' })} />
            </div>
          </section>

          <section aria-labelledby="release-h">
            <h2 id="release-h" className={LEGEND}>First release</h2>
            <CheckRow id="release-on" label="Start a first draft release" hint="Optional. A draft you can finish from the Releases board." checked={draft.release.enabled} disabled={face === 'label' && rosterNames(draft).length === 0 && !draft.release.enabled} onChange={(v) => update({ ...draft, release: { ...draft.release, enabled: v } })} />
            {face === 'label' && rosterNames(draft).length === 0 ? <p className="text-[11px] text-white/50">Add a roster artist in step 3 to start a release for them.</p> : null}
            {draft.release.enabled ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2" data-testid="wizard-release">
                <Field label="Release title" value={draft.release.title} maxLength={300} onChange={(e) => update({ ...draft, release: { ...draft.release, title: e.target.value } })} />
                <div>
                  <p className={LEGEND}>Type</p>
                  <Dropdown aria-label="Release type" value={draft.release.type} onChange={(v) => update({ ...draft, release: { ...draft.release, type: RELEASE_TYPES.find((t) => t === v) ?? 'single' } })} options={RELEASE_TYPES.map((t) => ({ value: t, label: t === 'ep' ? 'EP' : t[0].toUpperCase() + t.slice(1) }))} />
                </div>
                {face === 'label' ? (
                  <div className="sm:col-span-2">
                    <p className={LEGEND}>Artist</p>
                    <Dropdown aria-label="Release artist" value={String(draft.release.artistIndex)} onChange={(v) => update({ ...draft, release: { ...draft.release, artistIndex: Number(v) || 0 } })} options={rosterNames(draft).map((n, i) => ({ value: String(i), label: n }))} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul role="alert" className="space-y-1 rounded-lg border border-[#8d3a2f]/60 bg-[#8d3a2f]/15 px-3 py-2 text-[11px] text-[#ffb7a8]" data-testid="wizard-problems">
          {shown.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-[#8d3a2f]/60 bg-[#8d3a2f]/15 px-3 py-2 text-[11px] text-[#ffb7a8]" data-testid="wizard-error">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {index > 0 ? <Button variant="ghost" onClick={() => go(previousStep(draft.step))} disabled={busy}>Back</Button> : null}
          {step.skippable && !isLast ? <Button variant="ghost" onClick={skip} disabled={busy}>Skip</Button> : null}
        </div>
        {isLast ? (
          <Button variant="primary" onClick={create} loading={busy} data-testid="wizard-create">
            {busy ? 'Creating…' : face === 'label' ? 'Create label' : 'Create workspace'}
          </Button>
        ) : (
          <Button variant="primary" onClick={advance} disabled={busy} data-testid="wizard-next">Next</Button>
        )}
      </div>

      <p className="text-center text-[11px] text-white/60">
        Only here to buy beats?{' '}
        <a href={BUYER_HOME} className="text-white/80 underline-offset-2 hover:text-white hover:underline">Go to your buyer account</a>
      </p>
      {busy ? <Loader2 className="sr-only" aria-hidden /> : null}
    </div>
  );
}
