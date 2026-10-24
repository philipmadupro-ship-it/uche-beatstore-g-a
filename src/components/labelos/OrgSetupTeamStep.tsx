'use client';

/**
 * Wizard step 3, "Team and roster" (LABEL-48). Collects who to add; adds
 * nobody. Everything here is held in the wizard's draft and sent at the last
 * step through the routes that own the rules (roster: POST …/contacts,
 * people: POST …/invitations or …/team-accounts), so the role and function
 * choices come from the same tables the Members page uses
 * (`teamRoles` / `teamFunctions` → ROLES_BY_ORG_KIND / FUNCTIONS_BY_ORG_KIND).
 * LABEL-50 builds the full window later.
 *
 * A login's password is typed here, kept in memory only and never saved with
 * the resumable draft (lib/labelos/setup-wizard#serializeDraft).
 */
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { FUNCTION_LABELS, ROLE_LABELS } from '@/lib/labelos/invitations';
import { generatePassword } from '@/lib/labelos/team-accounts';
import {
  ROSTER_MAX,
  TEAM_MAX,
  emptyEntry,
  teamFunctions,
  teamRoles,
  type RosterEntry,
  type TeamEntry,
  type WizardDraft,
} from '@/lib/labelos/setup-wizard';

const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';
const CHIP = 'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';
const CHIP_OFF = 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]';
const ROW = 'space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3';

function freshPassword(): string {
  return generatePassword((n) => crypto.getRandomValues(new Uint32Array(n)));
}

export function OrgSetupTeamStep({
  draft,
  onChange,
  disabled,
}: {
  draft: WizardDraft;
  onChange: (next: WizardDraft) => void;
  disabled: boolean;
}) {
  const face = draft.face;
  if (!face) return null;
  const label = face === 'label';
  const roles = teamRoles(face);
  const functions = teamFunctions(face);

  const setRoster = (roster: RosterEntry[]) => onChange({ ...draft, roster });
  const setTeam = (team: TeamEntry[]) => onChange({ ...draft, team });
  const patchRoster = (i: number, patch: Partial<RosterEntry>) => setRoster(draft.roster.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const patchTeam = (i: number, patch: Partial<TeamEntry>) => setTeam(draft.team.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-8" data-testid="wizard-team">
      {label ? (
        <section aria-labelledby="roster-h">
          <h2 id="roster-h" className={LEGEND}>Roster artists</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-white/60">
            The artists you work with. Each gets their own workspace in the label. Their email is optional; add it to invite them later.
          </p>
          <ul className="space-y-3">
            {draft.roster.map((r, i) => (
              <li key={i} className={ROW} data-testid="roster-row">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Artist name" value={r.name} maxLength={200} disabled={disabled} onChange={(e) => patchRoster(i, { name: e.target.value })} />
                  <Field label="Email (optional)" type="email" autoComplete="off" value={r.email} maxLength={200} disabled={disabled} onChange={(e) => patchRoster(i, { email: e.target.value })} />
                </div>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setRoster(draft.roster.filter((_, k) => k !== i))} aria-label={`Remove artist ${i + 1}`}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={disabled || draft.roster.length >= ROSTER_MAX}
            onClick={() => setRoster([...draft.roster, { name: '', email: '' }])}
          >
            <Plus size={14} aria-hidden="true" /> Add artist
          </Button>
        </section>
      ) : (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[11px] leading-relaxed text-white/70" data-testid="wizard-solo-note">
          You are the artist of this workspace, so there is no roster to fill in. Collaborators and beatmakers can be added once it exists.
        </p>
      )}

      <section aria-labelledby="team-h">
        <h2 id="team-h" className={LEGEND}>People</h2>
        <p className="mb-3 text-[11px] leading-relaxed text-white/60">
          Invite them by email and they join with their own account. For a company address you control you can instead create their login now; they are asked to choose their own password on first sign-in.
        </p>
        <ul className="space-y-3">
          {draft.team.map((t, i) => (
            <li key={i} className={ROW} data-testid="team-row">
              <Field label="Email address" type="email" autoComplete="off" value={t.email} maxLength={200} disabled={disabled} onChange={(e) => patchTeam(i, { email: e.target.value })} />
              <fieldset>
                <legend className={LEGEND}>Role</legend>
                <div role="radiogroup" aria-label={`Role of person ${i + 1}`} className="flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      role="radio"
                      aria-checked={t.role === role}
                      disabled={disabled}
                      onClick={() => patchTeam(i, { role, fn: role === 'member' ? t.fn : null })}
                      className={cn(CHIP, t.role === role ? CHIP_ON : CHIP_OFF)}
                    >
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
              </fieldset>
              {t.role === 'member' ? (
                <div>
                  <p className={LEGEND}>Function</p>
                  <Dropdown
                    aria-label={`Function of person ${i + 1}`}
                    value={t.fn ?? ''}
                    placeholder="Choose a function"
                    disabled={disabled}
                    onChange={(v) => patchTeam(i, { fn: functions.find((f) => f === v) ?? null })}
                    options={functions.map((f) => ({ value: f, label: FUNCTION_LABELS[f] }))}
                  />
                </div>
              ) : null}
              <fieldset>
                <legend className={LEGEND}>How they get in</legend>
                <div role="radiogroup" aria-label={`How person ${i + 1} gets in`} className="flex flex-wrap gap-2">
                  {(['invite', 'login'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={t.mode === mode}
                      disabled={disabled}
                      onClick={() => patchTeam(i, { mode, password: mode === 'login' && !t.password ? freshPassword() : t.password })}
                      className={cn(CHIP, t.mode === mode ? CHIP_ON : CHIP_OFF)}
                    >
                      {mode === 'invite' ? 'Send an invitation' : 'Create their login'}
                    </button>
                  ))}
                </div>
              </fieldset>
              {t.mode === 'login' ? (
                <div className="space-y-3">
                  <Field label="Their name" value={t.name} maxLength={80} disabled={disabled} onChange={(e) => patchTeam(i, { name: e.target.value })} />
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Field
                        label="Password"
                        type="text"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={t.password}
                        disabled={disabled}
                        onChange={(e) => patchTeam(i, { password: e.target.value })}
                        helperText="Shown only here. It is not saved if you leave and come back; you will type or generate it again."
                      />
                    </div>
                    <Button variant="secondary" size="sm" disabled={disabled} onClick={() => patchTeam(i, { password: freshPassword() })} aria-label="Generate a password">
                      <RefreshCw size={14} aria-hidden="true" /> Generate
                    </Button>
                  </div>
                </div>
              ) : null}
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setTeam(draft.team.filter((_, k) => k !== i))} aria-label={`Remove person ${i + 1}`}>
                <Trash2 size={14} aria-hidden="true" /> Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" className="mt-3" disabled={disabled || draft.team.length >= TEAM_MAX} onClick={() => setTeam([...draft.team, emptyEntry()])}>
          <Plus size={14} aria-hidden="true" /> Add a person
        </Button>
      </section>
    </div>
  );
}
