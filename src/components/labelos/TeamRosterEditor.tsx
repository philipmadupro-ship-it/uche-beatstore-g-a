'use client';

/**
 * The "Team and roster" window's editor (LABEL-50): the forms for adding
 * artists, people and collaborators. ONE component, used twice — by the setup
 * wizard's third step (entries kept in the wizard's draft, sent when the org
 * is created) and by the Team page (`TeamRosterWindow`, entries sent when the
 * person presses Add). It adds nothing itself: the rules are
 * `lib/labelos/team-roster`, the requests are sent by its runner.
 *
 * Role and function choices come from the same tables the Team page and the
 * routes use (`teamRoles` / `teamFunctions`), so the form never offers what a
 * route would refuse. A login's password is typed or generated here and held
 * in memory only.
 */
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { EXTERNAL_PROJECT_ROLES, FUNCTIONS_BY_ORG_KIND, type OrgKind } from '@/lib/labelos/capabilities';
import { FUNCTION_LABELS, ROLE_LABELS, invitableRoles } from '@/lib/labelos/invitations';
import { PROJECT_ROLE_LABELS } from '@/lib/labelos/project-members';
import { generatePassword } from '@/lib/labelos/team-accounts';
import {
  COLLABORATOR_KINDS,
  ENTRY_MAX,
  emptyArtist,
  emptyCollaborator,
  emptyPerson,
  rosterWording,
  type ArtistEntry,
  type CollaboratorEntry,
  type PersonEntry,
  type TeamRosterEntries,
} from '@/lib/labelos/team-roster';

const LEGEND = 'mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';
const CHIP = 'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';
const CHIP_OFF = 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]';
const ROW = 'space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3';

function freshPassword(): string {
  return generatePassword((n) => crypto.getRandomValues(new Uint32Array(n)));
}

export type ArtistChoice = { key: string; name: string };
export type ProjectChoices = { id: string; name: string }[] | 'failed' | null;

export type TeamRosterEditorProps = {
  orgKind: OrgKind;
  entries: TeamRosterEntries;
  onChange: (next: TeamRosterEntries) => void;
  disabled: boolean;
  /** Which sections to show (lib/labelos/team-roster#availableAdds). */
  adds: { member: boolean; artist: boolean; collaborator: boolean; projectInvite: boolean };
  /** Roster artists that already exist, for scoping a member (live only). */
  existingArtists?: ArtistChoice[];
  /** Projects a collaborator can be invited to (live only); null = loading. */
  projects?: ProjectChoices;
  /** Replaces the container's test id, so each host keeps its own. */
  testId?: string;
  soloNoteTestId?: string;
};

export function TeamRosterEditor({
  orgKind,
  entries,
  onChange,
  disabled,
  adds,
  existingArtists = [],
  projects,
  testId = 'team-roster-editor',
  soloNoteTestId = 'roster-solo-note',
}: TeamRosterEditorProps) {
  const wording = rosterWording(orgKind);
  const roles = invitableRoles(orgKind).filter((r): r is 'admin' | 'member' => r === 'admin' || r === 'member');
  const functions = [...FUNCTIONS_BY_ORG_KIND[orgKind]];
  const set = (patch: Partial<TeamRosterEntries>) => onChange({ ...entries, ...patch });

  // Artists a limited member can be pointed at: the ones being added (by name) and the ones already there.
  const artistChoices: ArtistChoice[] = [
    ...existingArtists,
    ...entries.artists.filter((a) => a.name.trim()).map((a) => ({ key: a.name.trim(), name: a.name.trim() })),
  ];

  const patchArtist = (i: number, patch: Partial<ArtistEntry>) => {
    const before = entries.artists[i];
    const artists = entries.artists.map((r, k) => (k === i ? { ...r, ...patch } : r));
    // A member limited to this artist follows the artist's new name.
    if (patch.name !== undefined && before.name.trim() && before.name.trim() !== patch.name.trim()) {
      const from = before.name.trim();
      const to = patch.name.trim();
      set({
        artists,
        people: entries.people.map((p) => ({ ...p, artists: (p.artists ?? []).map((a) => (a === from ? to : a)).filter(Boolean) })),
      });
      return;
    }
    set({ artists });
  };
  const removeArtist = (i: number) => {
    const gone = entries.artists[i].name.trim();
    set({
      artists: entries.artists.filter((_, k) => k !== i),
      people: gone ? entries.people.map((p) => ({ ...p, artists: (p.artists ?? []).filter((a) => a !== gone) })) : entries.people,
    });
  };
  const patchPerson = (i: number, patch: Partial<PersonEntry>) => set({ people: entries.people.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
  const patchCollaborator = (i: number, patch: Partial<CollaboratorEntry>) =>
    set({ collaborators: entries.collaborators.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  return (
    <div className="space-y-8" data-testid={testId}>
      {adds.artist ? (
        <section aria-labelledby="roster-h">
          <h2 id="roster-h" className={LEGEND}>{wording.artists}</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-white/60">
            The artists you work with. Each gets their own workspace in the label. Their email is optional; add it to invite them to sign in.
          </p>
          <ul className="space-y-3">
            {entries.artists.map((r, i) => (
              <li key={i} className={ROW} data-testid="roster-row">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Artist name" value={r.name} maxLength={200} disabled={disabled} onChange={(e) => patchArtist(i, { name: e.target.value })} />
                  <Field label="Email (optional)" type="email" autoComplete="off" value={r.email} maxLength={200} disabled={disabled} onChange={(e) => patchArtist(i, { email: e.target.value })} />
                </div>
                {adds.member ? (
                  <label className="flex min-h-9 items-center gap-2 text-xs text-white/80">
                    <input
                      type="checkbox"
                      checked={r.invite === true}
                      disabled={disabled || !r.email.trim()}
                      onChange={(e) => patchArtist(i, { invite: e.target.checked })}
                      aria-label={`Invite artist ${i + 1} to sign in`}
                    />
                    Invite them to sign in
                    <span className="text-white/40">{r.email.trim() ? '' : '(needs an email)'}</span>
                  </label>
                ) : null}
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeArtist(i)} aria-label={`Remove artist ${i + 1}`}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" disabled={disabled || entries.artists.length >= ENTRY_MAX} onClick={() => set({ artists: [...entries.artists, emptyArtist()] })}>
            <Plus size={14} aria-hidden="true" /> Add artist
          </Button>
        </section>
      ) : orgKind === 'artist' ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[11px] leading-relaxed text-white/70" data-testid={soloNoteTestId}>
          You are the artist of this workspace, so there is no roster to fill in. The people you make music with are {wording.collaborators.toLowerCase()}: add them below.
        </p>
      ) : null}

      {adds.member ? (
        <section aria-labelledby="team-h">
          <h2 id="team-h" className={LEGEND}>People</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-white/60">
            Invite them by email and they join with their own account. For a company address you control you can instead create their login now; they are asked to choose their own password on first sign-in.
          </p>
          <ul className="space-y-3">
            {entries.people.map((t, i) => (
              <li key={i} className={ROW} data-testid="team-row">
                <Field label="Email address" type="email" autoComplete="off" value={t.email} maxLength={200} disabled={disabled} onChange={(e) => patchPerson(i, { email: e.target.value })} />
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
                        onClick={() => patchPerson(i, { role, fn: role === 'member' ? t.fn : null, ...(role === 'admin' ? { scope: 'org', artists: [] } : {}) })}
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
                      onChange={(v) => patchPerson(i, { fn: functions.find((f) => f === v) ?? null })}
                      options={functions.map((f) => ({ value: f, label: FUNCTION_LABELS[f] }))}
                    />
                  </div>
                ) : null}
                {t.role === 'member' && artistChoices.length > 0 ? (
                  <fieldset>
                    <legend className={LEGEND}>Sees</legend>
                    <div role="radiogroup" aria-label={`What person ${i + 1} sees`} className="flex flex-wrap gap-2">
                      {(['org', 'artists'] as const).map((scope) => (
                        <button
                          key={scope}
                          type="button"
                          role="radio"
                          aria-checked={(t.scope ?? 'org') === scope}
                          disabled={disabled}
                          onClick={() => patchPerson(i, { scope })}
                          className={cn(CHIP, (t.scope ?? 'org') === scope ? CHIP_ON : CHIP_OFF)}
                        >
                          {scope === 'org' ? 'Whole organization' : 'Selected artists'}
                        </button>
                      ))}
                    </div>
                    {t.scope === 'artists' ? (
                      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Artists person ${i + 1} sees`}>
                        {artistChoices.map((a) => {
                          const on = (t.artists ?? []).includes(a.key);
                          return (
                            <button
                              key={a.key}
                              type="button"
                              role="switch"
                              aria-checked={on}
                              disabled={disabled}
                              onClick={() => patchPerson(i, { artists: on ? (t.artists ?? []).filter((k) => k !== a.key) : [...(t.artists ?? []), a.key] })}
                              className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                            >
                              {a.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </fieldset>
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
                        onClick={() => patchPerson(i, { mode, password: mode === 'login' && !t.password ? freshPassword() : t.password })}
                        className={cn(CHIP, t.mode === mode ? CHIP_ON : CHIP_OFF)}
                      >
                        {mode === 'invite' ? 'Send an invitation' : 'Create their login'}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {t.mode === 'login' ? (
                  <div className="space-y-3">
                    <Field label="Their name" value={t.name} maxLength={80} disabled={disabled} onChange={(e) => patchPerson(i, { name: e.target.value })} />
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Field
                          label="Password"
                          type="text"
                          autoComplete="new-password"
                          spellCheck={false}
                          value={t.password}
                          disabled={disabled}
                          onChange={(e) => patchPerson(i, { password: e.target.value })}
                          helperText="Shown only here and once after they are added. It is never saved."
                        />
                      </div>
                      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => patchPerson(i, { password: freshPassword() })} aria-label="Generate a password">
                        <RefreshCw size={14} aria-hidden="true" /> Generate
                      </Button>
                    </div>
                  </div>
                ) : null}
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ people: entries.people.filter((_, k) => k !== i) })} aria-label={`Remove person ${i + 1}`}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" disabled={disabled || entries.people.length >= ENTRY_MAX} onClick={() => set({ people: [...entries.people, emptyPerson()] })}>
            <Plus size={14} aria-hidden="true" /> Add a person
          </Button>
        </section>
      ) : null}

      {adds.collaborator ? (
        <section aria-labelledby="collab-h">
          <h2 id="collab-h" className={LEGEND}>{wording.collaborators}</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-white/60">
            Beatmakers, producers, engineers, rappers and features you work with. They go in your directory with a role; they are not on the roster
            {adds.projectInvite ? ', and can be invited to one project to listen, comment or upload' : ''}.
          </p>
          <ul className="space-y-3">
            {entries.collaborators.map((c, i) => (
              <li key={i} className={ROW} data-testid="collaborator-row">
                <fieldset>
                  <legend className={LEGEND}>Role</legend>
                  <div role="radiogroup" aria-label={`Role of collaborator ${i + 1}`} className="flex flex-wrap gap-2">
                    {COLLABORATOR_KINDS.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={c.kind === k.id}
                        disabled={disabled}
                        onClick={() => patchCollaborator(i, { kind: k.id })}
                        className={cn(CHIP, c.kind === k.id ? CHIP_ON : CHIP_OFF)}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Collaborator name" value={c.name} maxLength={200} disabled={disabled} onChange={(e) => patchCollaborator(i, { name: e.target.value })} />
                  <Field label="Collaborator email (optional)" type="email" autoComplete="off" value={c.email} maxLength={200} disabled={disabled} onChange={(e) => patchCollaborator(i, { email: e.target.value })} />
                </div>
                {adds.projectInvite ? (
                  projects === 'failed' ? (
                    <p role="alert" className="text-[11px] text-[var(--error-text)]">Could not load the projects. Reload to invite them to one.</p>
                  ) : projects && projects.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className={LEGEND}>Also invite to a project</p>
                        <Dropdown
                          aria-label={`Project for collaborator ${i + 1}`}
                          value={c.projectId}
                          placeholder="No project"
                          disabled={disabled}
                          onChange={(v) => patchCollaborator(i, { projectId: v })}
                          options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                        />
                      </div>
                      {c.projectId ? (
                        <div>
                          <p className={LEGEND}>On the project they</p>
                          <Dropdown
                            aria-label={`Project role of collaborator ${i + 1}`}
                            value={c.projectRole}
                            disabled={disabled}
                            onChange={(v) => patchCollaborator(i, { projectRole: EXTERNAL_PROJECT_ROLES.find((r) => r === v) ?? 'viewer' })}
                            options={EXTERNAL_PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABELS[r] }))}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null
                ) : null}
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ collaborators: entries.collaborators.filter((_, k) => k !== i) })} aria-label={`Remove collaborator ${i + 1}`}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" disabled={disabled || entries.collaborators.length >= ENTRY_MAX} onClick={() => set({ collaborators: [...entries.collaborators, emptyCollaborator()] })}>
            <Plus size={14} aria-hidden="true" /> Add collaborator
          </Button>
        </section>
      ) : null}
    </div>
  );
}
